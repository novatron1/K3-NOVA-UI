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

  it("submit text never persists the prompt", async () => {
    const clock = new ManualClock();
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const consoleWrite = vi.spyOn(console, "log").mockImplementation(() => {});
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);
    let generatedSynchronously = false;
    const host = new FakePresentationHost(makeScript({
      onText: (text) => {
        expect(text).toBe("raw private prompt");
        generatedSynchronously = true;
        return [messageEvent("response", "synthetic response")];
      },
    }), clock);

    const session = await host.connect(
      handlers(),
      new AbortController().signal,
    );
    await session.submitText("raw private prompt");

    expect(generatedSynchronously).toBe(true);
    expect(JSON.stringify(host)).not.toContain("raw private prompt");
    expect(JSON.stringify(session)).not.toContain("raw private prompt");
    expect(storageWrite).not.toHaveBeenCalled();
    expect(consoleWrite).not.toHaveBeenCalled();
    expect(networkCall).not.toHaveBeenCalled();
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
