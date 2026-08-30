import { describe, expect, it, vi } from "vitest";

import type { HostPresentationEvent } from "../../src/domain/presentation-events";
import { TermuxPresentationHost } from "../../src/host/termux-presentation-host";
import type { PresentationHostHandlers } from "../../src/host/presentation-host";

const BASE_URL = "http://127.0.0.1:8765";
const TOKEN = "local-termux-token";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(values: readonly unknown[]): Response {
  return new Response(
    values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join(""),
    {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    },
  );
}

function handlers(): PresentationHostHandlers & {
  readonly events: HostPresentationEvent[];
  readonly fatalErrors: Array<"invalid_event" | "host_unavailable">;
} {
  const events: HostPresentationEvent[] = [];
  const fatalErrors: Array<"invalid_event" | "host_unavailable"> = [];
  return {
    events,
    fatalErrors,
    onEvent: (event) => events.push(event as HostPresentationEvent),
    onFatalError: (code) => fatalErrors.push(code),
  };
}

const PROFILE = Object.freeze({
  id: "9478032a-5fed-415c-b379-f20a985cc62f",
  display_name: "Nova Qwen 1.5B Q4",
  file_path: "/storage/emulated/0/Download/NovaModels/nova-qwen.gguf",
  model_family: null,
  context_size: 8192,
  threads: 6,
  batch_size: 256,
  temperature: 0.7,
  top_p: 0.95,
  top_k: 40,
  repeat_penalty: 1.05,
  max_output_tokens: 512,
  chat_template_override: null,
  selected: true,
});

describe("TermuxPresentationHost", () => {
  it("connects to the authenticated loopback backend and emits only sanitized local presentation data", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (url.endsWith("/status")) {
        return jsonResponse({
          ok: true,
          bind_host: "127.0.0.1",
          db_ready: true,
          model_ready: true,
          memory_count: 1,
          selected_model: PROFILE,
          llama: { ok: true, data: { status: "ok" } },
        });
      }
      if (url.endsWith("/models")) {
        return jsonResponse([PROFILE]);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const hostHandlers = handlers();
    const host = new TermuxPresentationHost(BASE_URL, TOKEN, fetchImpl);
    const session = await host.connect(hostHandlers, new AbortController().signal);
    const inventory = await session.getLocalModels();

    expect(hostHandlers.fatalErrors).toEqual([]);
    expect(hostHandlers.events[0]).toMatchObject({
      type: "snapshot",
      snapshot: {
        trustTone: "trusted_local",
        providerLabel: "Termux · llama.cpp",
        modelLabel: "Nova Qwen 1.5B Q4",
        privacyClass: "private",
      },
    });

    expect(inventory.models).toHaveLength(1);
    expect(inventory.models[0]?.modelId).toMatch(/^local_[0-9a-f]{64}$/);
    expect(inventory.models[0]).toMatchObject({
      displayName: "Nova Qwen 1.5B Q4",
      engine: "llama.cpp",
      source: "gguf",
      contextLength: 8192,
      runtimeState: "ready",
    });
    expect(JSON.stringify(inventory)).not.toContain("/storage/emulated");
    expect(requests.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("turns Nova SSE chat tokens into cumulative UI messages without exposing backend scaffolding", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/status")) {
        return jsonResponse({
          ok: true,
          bind_host: "127.0.0.1",
          db_ready: true,
          model_ready: true,
          memory_count: 1,
          selected_model: PROFILE,
          llama: { ok: true, data: { status: "ok" } },
        });
      }
      if (url.endsWith("/models")) {
        return jsonResponse([PROFILE]);
      }
      if (url.endsWith("/chat") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toMatchObject({
          message: "What checkpoint does Rabbit use?",
        });
        return jsonResponse({ request_id: "request-1" });
      }
      if (url.endsWith("/chat/stream/request-1")) {
        return sseResponse([
          { type: "start", request_id: "inner-1", context: { budgets: { recent: 4505 } } },
          { type: "token", request_id: "inner-1", token: "Project Rabbit " },
          { type: "token", request_id: "inner-1", token: "uses checkpoint 12000." },
          { type: "done", request_id: "inner-1", text: "Project Rabbit uses checkpoint 12000." },
        ]);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const hostHandlers = handlers();
    const host = new TermuxPresentationHost(BASE_URL, TOKEN, fetchImpl);
    const session = await host.connect(hostHandlers, new AbortController().signal);

    await session.submitText("What checkpoint does Rabbit use?");

    const userMessage = hostHandlers.events.find(
      (event) => event.type === "message" && event.message.author === "user",
    );
    const novaMessage = hostHandlers.events.find(
      (event) => event.type === "message" && event.message.author === "nova",
    );
    const replacements = hostHandlers.events.filter(
      (event) => event.type === "message_replaced",
    );

    expect(userMessage).toMatchObject({
      type: "message",
      message: { text: "What checkpoint does Rabbit use?" },
    });
    expect(novaMessage).toMatchObject({
      type: "message",
      message: { text: "Project Rabbit " },
    });
    expect(replacements.at(-1)).toMatchObject({
      type: "message_replaced",
      text: "Project Rabbit uses checkpoint 12000.",
    });
    expect(
      hostHandlers.events.some(
        (event) => event.type === "snapshot" && event.snapshot.phase === "idle",
      ),
    ).toBe(true);
    expect(JSON.stringify(hostHandlers.events)).not.toContain("RECENT CONVERSATION");
  });
});
