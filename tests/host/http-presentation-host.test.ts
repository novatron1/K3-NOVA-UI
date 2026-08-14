import { describe, expect, it, vi } from "vitest";

import type { HostPresentationEvent } from "../../src/domain/presentation-events";
import { HttpPresentationHost } from "../../src/host/http-presentation-host";
import type { PresentationHostHandlers } from "../../src/host/presentation-host";

function messageEvent(id = "message-1"): HostPresentationEvent {
  return {
    type: "message",
    message: {
      id,
      author: "nova",
      text: "sanitized response",
      createdAt: "2026-08-14T00:00:00.000Z",
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function handlers(): PresentationHostHandlers & {
  readonly events: unknown[];
  readonly fatalErrors: Array<"invalid_event" | "host_unavailable">;
} {
  const events: unknown[] = [];
  const fatalErrors: Array<"invalid_event" | "host_unavailable"> = [];
  return {
    events,
    fatalErrors,
    onEvent: (event) => events.push(event),
    onFatalError: (code) => fatalErrors.push(code),
  };
}

describe("HttpPresentationHost", () => {
  it("creates a session, emits validated events, and uses the presentation protocol", async () => {
    const requests: Array<{
      readonly url: string;
      readonly method: string;
      readonly body: string | null;
    }> = [];
    const responses: Response[] = [
      jsonResponse({ sessionId: "session/1", events: [messageEvent()] }),
      jsonResponse({ events: [] }),
      jsonResponse({ events: [] }),
      jsonResponse({ events: [] }),
      jsonResponse({ events: [] }),
      new Response(null, { status: 204 }),
    ];
    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("Unexpected request");
      }
      return response;
    });
    const hostHandlers = handlers();
    const lifecycle = new AbortController();
    const host = new HttpPresentationHost(
      "https://nova.example.test/base",
      fetchImpl,
    );

    const session = await host.connect(hostHandlers, lifecycle.signal);
    await session.submitText("hello");
    await session.submitVoiceTranscript("voice text");
    await session.decidePermission("approval/1", "approve");
    await session.cancel();
    await session.close();

    expect(hostHandlers.events).toEqual([messageEvent()]);
    expect(hostHandlers.fatalErrors).toEqual([]);
    expect(requests).toEqual([
      {
        url: "https://nova.example.test/base/v1/presentation/sessions",
        method: "POST",
        body: null,
      },
      {
        url: "https://nova.example.test/base/v1/presentation/sessions/session%2F1/text",
        method: "POST",
        body: JSON.stringify({ text: "hello" }),
      },
      {
        url: "https://nova.example.test/base/v1/presentation/sessions/session%2F1/voice-transcript",
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
  });

  it("fails closed when a configured backend is unavailable", async () => {
    const hostHandlers = handlers();
    const fetchImpl: typeof fetch = vi.fn(async () => {
      throw new Error("network details that must not reach the UI");
    });
    const host = new HttpPresentationHost(
      "https://nova.example.test",
      fetchImpl,
    );

    await expect(
      host.connect(hostHandlers, new AbortController().signal),
    ).rejects.toThrow();
    expect(hostHandlers.events).toEqual([]);
    expect(hostHandlers.fatalErrors).toEqual(["host_unavailable"]);
  });

  it("rejects invalid events before they reach application state", async () => {
    const hostHandlers = handlers();
    const fetchImpl: typeof fetch = vi.fn(async () => jsonResponse({
      sessionId: "s1",
      events: [{ type: "message", message: { text: "missing fields" } }],
    }));
    const host = new HttpPresentationHost(
      "https://nova.example.test",
      fetchImpl,
    );

    await expect(
      host.connect(hostHandlers, new AbortController().signal),
    ).rejects.toThrow();
    expect(hostHandlers.events).toEqual([]);
    expect(hostHandlers.fatalErrors).toEqual(["invalid_event"]);
  });

  it("treats malformed JSON and non-2xx responses as host unavailable", async () => {
    const malformedHandlers = handlers();
    const malformedHost = new HttpPresentationHost(
      "https://nova.example.test",
      vi.fn(async () => new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    );
    await expect(
      malformedHost.connect(malformedHandlers, new AbortController().signal),
    ).rejects.toThrow();
    expect(malformedHandlers.fatalErrors).toEqual(["host_unavailable"]);

    const failedHandlers = handlers();
    const failedHost = new HttpPresentationHost(
      "https://nova.example.test",
      vi.fn(async () => new Response("provider-secret-bearing-error", {
        status: 503,
      })),
    );
    await expect(
      failedHost.connect(failedHandlers, new AbortController().signal),
    ).rejects.toThrow();
    expect(failedHandlers.fatalErrors).toEqual(["host_unavailable"]);
  });

  it("passes the lifecycle signal to normal requests but not best-effort teardown", async () => {
    const seenSignals: Array<AbortSignal | null> = [];
    const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
      seenSignals.push(init?.signal instanceof AbortSignal ? init.signal : null);
      return seenSignals.length === 1
        ? jsonResponse({ sessionId: "s1", events: [] })
        : seenSignals.length === 2
          ? jsonResponse({ events: [] })
          : new Response(null, { status: 204 });
    });
    const lifecycle = new AbortController();
    const host = new HttpPresentationHost(
      "https://nova.example.test",
      fetchImpl,
    );
    const session = await host.connect(handlers(), lifecycle.signal);

    await session.submitText("hello");
    lifecycle.abort();
    await session.close();

    expect(seenSignals[0]).toBe(lifecycle.signal);
    expect(seenSignals[1]).toBe(lifecycle.signal);
    expect(seenSignals[2]).toBe(null);
  });
});
