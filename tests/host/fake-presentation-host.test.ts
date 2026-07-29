import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostPresentationEvent } from "../../src/domain/presentation-events";
import {
  FakePresentationHost,
  type FakeClock,
  type FakePresentationScript,
} from "../../src/host/fake-presentation-host";
import type {
  PresentationHostAdapter,
  PresentationHostHandlers,
  PresentationSession,
} from "../../src/host/presentation-host";
import { usePresentationController } from "../../src/state/use-presentation-controller";
import { makeSnapshot } from "../../src/test/fixtures";
import {
  UnavailableVoiceCapture,
  type VoiceCaptureAdapter,
} from "../../src/voice/voice-capture";

class ManualClock implements FakeClock {
  private readonly tasks: Array<{
    readonly callback: () => void;
    cancelled: boolean;
  }> = [];

  cancelCount = 0;

  get pendingCount(): number {
    return this.tasks.filter((task) => !task.cancelled).length;
  }

  readonly schedule = (_delayMs: number, callback: () => void): (() => void) => {
    const task = { callback, cancelled: false };
    this.tasks.push(task);

    return () => {
      if (!task.cancelled) {
        task.cancelled = true;
        this.cancelCount += 1;
      }
    };
  };

  flushAll(): void {
    for (const task of this.tasks.splice(0)) {
      if (!task.cancelled) {
        task.cancelled = true;
        task.callback();
      }
    }
  }
}

class SynchronousClock implements FakeClock {
  readonly schedule = (
    _delayMs: number,
    callback: () => void,
  ): (() => void) => {
    callback();
    return () => {};
  };
}

function messageEvent(id: string, text: string): HostPresentationEvent {
  return {
    type: "message",
    message: {
      id,
      author: "nova",
      text,
      createdAt: "2026-07-29T00:00:00.000Z",
    },
  };
}

function makeScript(
  overrides: Partial<FakePresentationScript> = {},
): FakePresentationScript {
  return {
    initialEvents: [],
    onText: () => [],
    onVoiceTranscript: () => [],
    onPermission: () => [],
    ...overrides,
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
    onEvent: (event) => {
      events.push(event as HostPresentationEvent);
    },
    onFatalError: (code) => {
      fatalErrors.push(code);
    },
  };
}

function callableConsoleMethodNames(source: Console): readonly string[] {
  const names = new Set<string>();
  let current: object | null = source;

  while (current !== null && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string" || key === "constructor") {
        continue;
      }

      let value: unknown;
      try {
        value = Reflect.get(source, key, source);
      } catch {
        continue;
      }
      if (typeof value === "function") {
        names.add(key);
      }
    }
    current = Object.getPrototypeOf(current) as object | null;
  }

  return Object.freeze([...names].sort());
}

function guardConsole(source: Console): {
  readonly value: Console;
  readonly spies: readonly {
    readonly name: string;
    readonly invoke: ReturnType<typeof vi.fn>;
  }[];
} {
  const guarded = Object.create(source) as object;
  const spies = callableConsoleMethodNames(source).map((name) => {
    const invoke = vi.fn();
    Object.defineProperty(guarded, name, {
      configurable: true,
      value: invoke,
    });
    return Object.freeze({ name, invoke });
  });

  return Object.freeze({
    value: guarded as Console,
    spies: Object.freeze(spies),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FakePresentationHost", () => {
  it("connects once and emits only scripted sanitized events", async () => {
    const clock = new ManualClock();
    const source = messageEvent("initial", "safe synthetic message");
    const hostHandlers = handlers();
    const host = new FakePresentationHost(
      makeScript({ initialEvents: [source] }),
      clock,
    );

    await host.connect(hostHandlers, new AbortController().signal);
    expect(clock.pendingCount).toBe(1);

    if (source.type !== "message") {
      throw new Error("invalid test fixture");
    }
    (source.message as { text: string }).text = "mutated after connect";
    clock.flushAll();

    expect(hostHandlers.fatalErrors).toEqual([]);
    expect(hostHandlers.events).toEqual([
      messageEvent("initial", "safe synthetic message"),
    ]);
    expect(hostHandlers.events[0]).not.toBe(source);
    expect(Object.isFrozen(hostHandlers.events[0])).toBe(true);
    expect(Object.isFrozen(hostHandlers.events[0]?.type === "message"
      ? hostHandlers.events[0].message
      : null)).toBe(true);
  });

  it("validates every event before dispatch", async () => {
    const clock = new ManualClock();
    const initial = {
      type: "snapshot",
      snapshot: makeSnapshot({ phase: "idle" }),
    } satisfies HostPresentationEvent;
    const text = messageEvent("text", "text response");
    const voice = messageEvent("voice", "voice response");
    const permission = {
      type: "session_closed",
      reason: "completed",
    } satisfies HostPresentationEvent;
    const hostHandlers = handlers();
    const host = new FakePresentationHost(makeScript({
      initialEvents: [initial],
      onText: () => [text],
      onVoiceTranscript: () => [voice],
      onPermission: () => [permission],
    }), clock);

    const session = await host.connect(
      hostHandlers,
      new AbortController().signal,
    );
    await session.submitText("private text");
    await session.submitVoiceTranscript("private transcript");
    await session.decidePermission("approval-1", "approve");
    clock.flushAll();

    expect(hostHandlers.fatalErrors).toEqual([]);
    expect(hostHandlers.events).toHaveLength(4);
    expect(hostHandlers.events[0]).not.toBe(initial);
    expect(hostHandlers.events[1]).not.toBe(text);
    expect(hostHandlers.events[2]).not.toBe(voice);
    expect(hostHandlers.events[3]).not.toBe(permission);
    expect(hostHandlers.events.every(Object.isFrozen)).toBe(true);
  });

  it("fails closed on a malformed scripted event", async () => {
    const clock = new ManualClock();
    const hostHandlers = handlers();
    const host = new FakePresentationHost(makeScript({
      initialEvents: [
        messageEvent("pending", "must be cancelled"),
        {
          type: "message",
          message: {
            id: "malformed",
            author: "nova",
            createdAt: "2026-07-29T00:00:00.000Z",
          },
        } as unknown as HostPresentationEvent,
      ],
    }), clock);

    const session = await host.connect(
      hostHandlers,
      new AbortController().signal,
    );
    clock.flushAll();
    await session.submitText("ignored after failure");

    expect(hostHandlers.fatalErrors).toEqual(["invalid_event"]);
    expect(hostHandlers.events).toEqual([]);
    expect(clock.pendingCount).toBe(0);
  });

  it("closes before fatal callbacks can submit reentrant work", async () => {
    const emitted: HostPresentationEvent[] = [];
    const fatalErrors: Array<"invalid_event" | "host_unavailable"> = [];
    const submittedTexts: string[] = [];
    let submittedVoiceTranscripts = 0;
    let permissionDecisions = 0;
    let session: PresentationSession | null = null;
    const host = new FakePresentationHost(makeScript({
      onText: (text) => {
        submittedTexts.push(text);
        return text === "trigger malformed event"
          ? [{
            type: "message",
            message: {
              id: "malformed",
              author: "nova",
              createdAt: "2026-07-29T00:00:00.000Z",
            },
          } as unknown as HostPresentationEvent]
          : [messageEvent("reentrant", "must never emit")];
      },
      onVoiceTranscript: () => {
        submittedVoiceTranscripts += 1;
        return [messageEvent("reentrant-voice", "must never emit")];
      },
      onPermission: () => {
        permissionDecisions += 1;
        return [messageEvent("reentrant-permission", "must never emit")];
      },
    }), new SynchronousClock());

    session = await host.connect({
      onEvent: (event) => {
        emitted.push(event as HostPresentationEvent);
      },
      onFatalError: (code) => {
        fatalErrors.push(code);
        if (session !== null) {
          void session.submitText("reentrant submission");
          void session.submitVoiceTranscript("reentrant transcript");
          void session.decidePermission("reentrant-approval", "approve");
        }
      },
    }, new AbortController().signal);

    await session.submitText("trigger malformed event");

    expect(fatalErrors).toEqual(["invalid_event"]);
    expect(submittedTexts).toEqual(["trigger malformed event"]);
    expect(submittedVoiceTranscripts).toBe(0);
    expect(permissionDecisions).toBe(0);
    expect(emitted).toEqual([]);
  });

  it("submit text never persists the prompt", async () => {
    const clock = new ManualClock();
    const promptSentinel = "RAW_PROMPT_SENTINEL_7EAC9C43";
    const initialHref = window.location.href;
    const initialSearch = window.location.search;
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const consoleGuard = guardConsole(console);
    vi.stubGlobal("console", consoleGuard.value);
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const fetchCall = vi.fn();
    const webSocketCall = vi.fn();
    const indexedDbOpen = vi.fn();
    const cacheOpen = vi.fn();
    const serviceWorkerRegister = vi.fn();
    const getUserMedia = vi.fn();
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, "open");
    const xhrSend = vi.spyOn(XMLHttpRequest.prototype, "send");
    vi.stubGlobal("fetch", fetchCall);
    vi.stubGlobal("WebSocket", webSocketCall);
    vi.stubGlobal("indexedDB", { open: indexedDbOpen });
    vi.stubGlobal("caches", { open: cacheOpen });
    const mediaDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    const workerDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "serviceWorker",
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: serviceWorkerRegister },
    });
    let generatedSynchronously = false;
    let submissionError: unknown = null;
    const hostHandlers = handlers();
    const host = new FakePresentationHost(makeScript({
      onText: (text) => {
        expect(text).toBe(promptSentinel);
        generatedSynchronously = true;
        return [messageEvent("response", "synthetic response")];
      },
    }), clock);

    try {
      const session = await host.connect(
        hostHandlers,
        new AbortController().signal,
      );
      try {
        await session.submitText(promptSentinel);
      } catch (error: unknown) {
        submissionError = error;
      }
      expect(clock.pendingCount).toBeGreaterThan(0);
      clock.flushAll();
      await session.close();

      expect(generatedSynchronously).toBe(true);
      expect(hostHandlers.events).toEqual([
        messageEvent("response", "synthetic response"),
      ]);
      expect(hostHandlers.fatalErrors).toEqual([]);
      expect(clock.pendingCount).toBe(0);
      expect(JSON.stringify({
        host,
        session,
        submissionError: submissionError instanceof Error
          ? {
            name: submissionError.name,
            message: submissionError.message,
          }
          : submissionError,
      })).not.toContain(promptSentinel);
      expect(window.localStorage.getItem(promptSentinel)).toBeNull();
      expect(window.sessionStorage.getItem(promptSentinel)).toBeNull();
      expect(storageWrite).not.toHaveBeenCalled();
      for (const consoleMethod of consoleGuard.spies) {
        expect(
          consoleMethod.invoke,
          `console.${consoleMethod.name} must remain unused`,
        ).not.toHaveBeenCalled();
      }
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState).not.toHaveBeenCalled();
      expect(window.location.href).toBe(initialHref);
      expect(window.location.search).toBe(initialSearch);
      expect(fetchCall).not.toHaveBeenCalled();
      expect(xhrOpen).not.toHaveBeenCalled();
      expect(xhrSend).not.toHaveBeenCalled();
      expect(webSocketCall).not.toHaveBeenCalled();
      expect(indexedDbOpen).not.toHaveBeenCalled();
      expect(cacheOpen).not.toHaveBeenCalled();
      expect(serviceWorkerRegister).not.toHaveBeenCalled();
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      if (window.location.href !== initialHref) {
        window.history.replaceState(null, "", initialHref);
      }
      if (mediaDescriptor === undefined) {
        Reflect.deleteProperty(navigator, "mediaDevices");
      } else {
        Object.defineProperty(navigator, "mediaDevices", mediaDescriptor);
      }
      if (workerDescriptor === undefined) {
        Reflect.deleteProperty(navigator, "serviceWorker");
      } else {
        Object.defineProperty(navigator, "serviceWorker", workerDescriptor);
      }
    }
  });

  it("cancel aborts pending fake work and closes the session", async () => {
    const clock = new ManualClock();
    let textScriptCalls = 0;
    const hostHandlers = handlers();
    const host = new FakePresentationHost(makeScript({
      initialEvents: [messageEvent("pending", "pending")],
      onText: () => {
        textScriptCalls += 1;
        return [messageEvent("late", "late")];
      },
    }), clock);

    const session = await host.connect(
      hostHandlers,
      new AbortController().signal,
    );
    await session.cancel();
    clock.flushAll();
    await session.submitText("must not run");

    expect(hostHandlers.events).toEqual([]);
    expect(textScriptCalls).toBe(0);
    expect(clock.pendingCount).toBe(0);
  });

  it("close is idempotent", async () => {
    const clock = new ManualClock();
    const hostHandlers = handlers();
    const host = new FakePresentationHost(makeScript({
      initialEvents: [messageEvent("pending", "pending")],
    }), clock);
    const session = await host.connect(
      hostHandlers,
      new AbortController().signal,
    );

    await session.close();
    await session.close();
    await session.cancel();
    clock.flushAll();

    expect(clock.cancelCount).toBe(1);
    expect(hostHandlers.events).toEqual([]);
    expect(hostHandlers.fatalErrors).toEqual([]);
  });

  it("unmount closes the session and voice adapter", async () => {
    const close = vi.fn<PresentationSession["close"]>().mockResolvedValue();
    const session: PresentationSession = {
      submitText: async () => {},
      submitVoiceTranscript: async () => {},
      decidePermission: async () => {},
      cancel: async () => {},
      close,
    };
    let connectedSignal: AbortSignal | null = null;
    const connect = vi.fn<PresentationHostAdapter["connect"]>(
      async (_hostHandlers, signal) => {
        connectedSignal = signal;
        return session;
      },
    );
    const host: PresentationHostAdapter = { connect };
    const voiceCancel = vi.fn<VoiceCaptureAdapter["cancel"]>().mockResolvedValue();
    const voice: VoiceCaptureAdapter = {
      available: true,
      start: async () => {},
      stopForReview: async () => "review",
      cancel: voiceCancel,
    };

    const view = renderHook(() => usePresentationController(host, voice));
    await waitFor(() => {
      expect(connect).toHaveBeenCalledTimes(1);
    });
    view.unmount();

    await waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1);
      expect(voiceCancel).toHaveBeenCalledTimes(1);
    });
    expect((connectedSignal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("contains synchronous host connection failures", async () => {
    const thrownSentinel = "SYNCHRONOUS_CONNECT_PRIVATE_SENTINEL";
    let connectedSignal: AbortSignal | null = null;
    const connect: PresentationHostAdapter["connect"] = (
      _hostHandlers,
      signal,
    ) => {
      connectedSignal = signal;
      throw new Error(thrownSentinel);
    };
    const host: PresentationHostAdapter = { connect };
    const voiceCancel = vi.fn<VoiceCaptureAdapter["cancel"]>().mockResolvedValue();
    const voice: VoiceCaptureAdapter = {
      available: true,
      start: async () => {},
      stopForReview: async () => "review",
      cancel: voiceCancel,
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const view = renderHook(() => usePresentationController(host, voice));

    await waitFor(() => {
      expect(view.result.current.sessionState).toBe("failed");
    });
    expect(view.result.current.sessionError).toBe(
      "The presentation host is unavailable.",
    );
    expect(view.result.current.sessionError).not.toContain(thrownSentinel);
    expect((connectedSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(voiceCancel).toHaveBeenCalledTimes(1);

    view.unmount();
    await waitFor(() => {
      expect(voiceCancel).toHaveBeenCalledTimes(2);
    });
  });

  it("unavailable voice capture never opens a microphone", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "mediaDevices",
    );
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    const voice = new UnavailableVoiceCapture();

    try {
      expect(voice.available).toBe(false);
      await expect(voice.start(new AbortController().signal)).rejects.toThrow(
        "Voice capture is unavailable.",
      );
      await expect(voice.stopForReview()).rejects.toThrow(
        "Voice capture is unavailable.",
      );
      await voice.cancel();
      await voice.cancel();
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(navigator, "mediaDevices");
      } else {
        Object.defineProperty(navigator, "mediaDevices", originalDescriptor);
      }
    }
  });
});
