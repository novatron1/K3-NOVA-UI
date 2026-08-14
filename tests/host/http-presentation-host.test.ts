import { describe, expect, it, vi } from "vitest";

import type { HostPresentationEvent } from "../../src/domain/presentation-events";
import { HttpPresentationHost } from "../../src/host/http-presentation-host";
import type { PresentationHostHandlers } from "../../src/host/presentation-host";

const TOKEN = "tablet-session-token";
const CREATED_AT = "2026-08-14T00:00:00.000Z";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ndjsonResponse(values: readonly unknown[]): Response {
  return new Response(
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    },
  );
}

function wireMessage(id: string, text: string): unknown {
  return {
    kind: "message",
    payload: {
      messageId: id,
      role: "nova",
      text,
      timestamp: CREATED_AT,
    },
  };
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

describe("HttpPresentationHost", () => {
  it("converts native backend NDJSON chunks into validated cumulative UI events", async () => {
    const fetchImpl: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/presentation/sessions")) {
        return jsonResponse({ sessionId: "session-1", protocolVersion: "tablet-v1" });
      }
      if (url.endsWith("/events")) {
        return ndjsonResponse([
          wireMessage("message-1", "hel"),
          wireMessage("message-1", "lo"),
          { kind: "message_replaced", payload: { messageId: "message-1", state: "complete" } },
          { kind: "session_closed", payload: { reason: "completed" } },
        ]);
      }
      throw new Error("unexpected request");
    });
    const hostHandlers = handlers();
    const host = new HttpPresentationHost(
      "https://nova.example.test",
      TOKEN,
      fetchImpl,
    );

    await host.connect(hostHandlers, new AbortController().signal);

    await vi.waitFor(() => {
      expect(hostHandlers.events).toEqual([
        {
          type: "message",
          message: {
            id: "message-1",
            author: "nova",
            text: "hel",
            createdAt: CREATED_AT,
          },
        },
        {
          type: "message_replaced",
          messageId: "message-1",
          text: "hello",
        },
        { type: "session_closed", reason: "completed" },
      ]);
    });
    expect(hostHandlers.fatalErrors).toEqual([]);
  });

  it("uses bearer auth and the remote presentation mutation paths", async () => {
    const requests: Array<{
      readonly url: string;
      readonly method: string;
      readonly authorization: string | null;
      readonly body: string | null;
    }> = [];
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        method: init?.method ?? "GET",
        authorization: headers.get("authorization"),
        body: typeof init?.body === "string" ? init.body : null,
      });
      if (url.endsWith("/v1/presentation/sessions")) {
        return jsonResponse({ sessionId: "session/1", protocolVersion: "tablet-v1" });
      }
      if (url.endsWith("/events")) {
        return ndjsonResponse([
          { kind: "session_closed", payload: { reason: "completed" } },
        ]);
      }
      return jsonResponse({ status: "accepted" });
    });
    const host = new HttpPresentationHost(
      "https://nova.example.test/base",
      TOKEN,
      fetchImpl,
    );
    const session = await host.connect(handlers(), new AbortController().signal);

    await session.submitText("hello");
    await session.submitVoiceTranscript("voice text");
    await session.decidePermission("approval/1", "approve");
    await session.cancel();
    await session.close();

    expect(requests.map(({ url, method, body }) => ({ url, method, body }))).toEqual([
      {
        url: "https://nova.example.test/base/v1/presentation/sessions",
        method: "POST",
        body: null,
      },
      {
        url: "https://nova.example.test/base/v1/presentation/sessions/session%2F1/events",
        method: "GET",
        body: null,
      },
      {
        url: "https://nova.example.test/base/v1/presentation/sessions/session%2F1/messages",
        method: "POST",
        body: JSON.stringify({ text: "hello" }),
      },
      {
        url: "https://nova.example.test/base/v1/presentation/sessions/session%2F1/voice-transcripts",
        method: "POST",
        body: JSON.stringify({ transcript: "voice text" }),
      },
      {
        url: "https://nova.example.test/base/v1/presentation/sessions/session%2F1/permissions/approval%2F1",
        method: "POST",
        body: JSON.stringify({ decision: "approve" }),
      },
      {
        url: "https://nova.example.test/base/v1/presentation/sessions/session%2F1/cancel",
        method: "POST",
        body: null,
      },
      {
        url: "https://nova.example.test/base/v1/presentation/sessions/session%2F1",
        method: "DELETE",
        body: null,
      },
    ]);
    expect(requests.every((request) => request.authorization === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("drops backend-only snapshot fields while preserving the trusted tablet snapshot", async () => {
    const wireSnapshot = {
      schemaVersion: 1,
      runId: "run-1",
      phase: "idle",
      trustTone: "trusted_local",
      statusLabel: "Ready",
      providerLabel: "Ollama",
      modelLabel: "nova-trained:latest",
      modelSelection: "auto",
      availableModelSelections: ["auto", "local_qwen", "kimi_k3"],
      providerHealth: [],
      privacyClass: "private",
      cloudConsentRequired: false,
      cloudConsentGranted: false,
      isolation: "unavailable",
      isolationLabel: "Unavailable",
      contractSummary: [],
      permissionSummary: [],
      ledgerSummary: [],
      evidence: "not_requested",
      evidenceLabel: "Not requested",
      budgetSummary: [],
      observerSummary: [],
      rollback: "not_required",
      rollbackLabel: "Not required",
      voiceAvailable: false,
      voiceLabel: "Unavailable",
      permissionGate: null,
    };
    const fetchImpl: typeof fetch = vi.fn(async (input) => (
      String(input).endsWith("/events")
        ? ndjsonResponse([
            { kind: "snapshot", payload: wireSnapshot },
            { kind: "session_closed", payload: { reason: "completed" } },
          ])
        : jsonResponse({ sessionId: "s1", protocolVersion: "tablet-v1" })
    ));
    const hostHandlers = handlers();
    const host = new HttpPresentationHost("https://nova.example.test", TOKEN, fetchImpl);

    await host.connect(hostHandlers, new AbortController().signal);

    await vi.waitFor(() => expect(hostHandlers.events.length).toBe(2));
    expect(hostHandlers.events[0]).toEqual({
      type: "snapshot",
      snapshot: {
        schemaVersion: 1,
        runId: "run-1",
        phase: "idle",
        trustTone: "trusted_local",
        statusLabel: "Ready",
        providerLabel: "Ollama",
        modelLabel: "nova-trained:latest",
        privacyClass: "private",
        cloudConsentRequired: false,
        cloudConsentGranted: false,
        isolation: "unavailable",
        isolationLabel: "Unavailable",
        contractSummary: [],
        permissionSummary: [],
        ledgerSummary: [],
        evidence: "not_requested",
        evidenceLabel: "Not requested",
        budgetSummary: [],
        observerSummary: [],
        rollback: "not_required",
        rollbackLabel: "Not required",
        permissionGate: null,
      },
    });
  });

  it("rejects invalid native events before they reach application state", async () => {
    const hostHandlers = handlers();
    const fetchImpl: typeof fetch = vi.fn(async (input) => (
      String(input).endsWith("/events")
        ? ndjsonResponse([{ kind: "message", payload: { text: "missing fields" } }])
        : jsonResponse({ sessionId: "s1", protocolVersion: "tablet-v1" })
    ));
    const host = new HttpPresentationHost("https://nova.example.test", TOKEN, fetchImpl);

    await host.connect(hostHandlers, new AbortController().signal);

    await vi.waitFor(() => expect(hostHandlers.fatalErrors).toEqual(["invalid_event"]));
    expect(hostHandlers.events).toEqual([]);
  });

  it("fails closed before network access when URL or presentation token is unavailable", async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({}));

    for (const host of [
      new HttpPresentationHost(null, TOKEN, fetchImpl),
      new HttpPresentationHost("https://nova.example.test", null, fetchImpl),
    ]) {
      const hostHandlers = handlers();
      await expect(
        host.connect(hostHandlers, new AbortController().signal),
      ).rejects.toThrow();
      expect(hostHandlers.fatalErrors).toEqual(["host_unavailable"]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
