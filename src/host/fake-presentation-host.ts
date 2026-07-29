import type { HostPresentationEvent } from "../domain/presentation-events";
import { validateHostEvent } from "../security/validate-host-event";
import type {
  PresentationHostAdapter,
  PresentationHostHandlers,
  PresentationSession,
} from "./presentation-host";

export interface FakeClock {
  readonly schedule: (
    delayMs: number,
    callback: () => void,
  ) => () => void;
}

export interface FakePresentationScript {
  readonly initialEvents: readonly HostPresentationEvent[];
  readonly onText: (text: string) => readonly HostPresentationEvent[];
  readonly onVoiceTranscript: (
    text: string,
  ) => readonly HostPresentationEvent[];
  readonly onPermission: (
    approvalRequestId: string,
    decision: "approve" | "deny" | "cancel",
  ) => readonly HostPresentationEvent[];
}

class FakePresentationSession implements PresentationSession {
  private readonly pending = new Set<() => void>();
  private closed = false;

  private readonly onAbort = (): void => {
    this.closeNow();
  };

  constructor(
    private readonly script: FakePresentationScript,
    private readonly clock: FakeClock,
    private readonly handlers: PresentationHostHandlers,
    private readonly signal: AbortSignal,
  ) {
    if (signal.aborted) {
      this.closed = true;
      return;
    }

    signal.addEventListener("abort", this.onAbort, { once: true });
    this.enqueue(script.initialEvents);
  }

  readonly submitText = (text: string): Promise<void> => {
    if (this.closed) {
      return Promise.resolve();
    }

    let events: readonly HostPresentationEvent[];
    try {
      events = this.script.onText(text);
    } catch {
      this.failClosed("host_unavailable");
      return Promise.resolve();
    }

    this.enqueue(events);
    return Promise.resolve();
  };

  readonly submitVoiceTranscript = (transcript: string): Promise<void> => {
    if (this.closed) {
      return Promise.resolve();
    }

    let events: readonly HostPresentationEvent[];
    try {
      events = this.script.onVoiceTranscript(transcript);
    } catch {
      this.failClosed("host_unavailable");
      return Promise.resolve();
    }

    this.enqueue(events);
    return Promise.resolve();
  };

  readonly decidePermission = (
    approvalRequestId: string,
    decision: "approve" | "deny" | "cancel",
  ): Promise<void> => {
    if (this.closed) {
      return Promise.resolve();
    }

    let events: readonly HostPresentationEvent[];
    try {
      events = this.script.onPermission(approvalRequestId, decision);
    } catch {
      this.failClosed("host_unavailable");
      return Promise.resolve();
    }

    this.enqueue(events);
    return Promise.resolve();
  };

  readonly cancel = (): Promise<void> => {
    this.closeNow();
    return Promise.resolve();
  };

  readonly close = (): Promise<void> => {
    this.closeNow();
    return Promise.resolve();
  };

  private enqueue(events: readonly HostPresentationEvent[]): void {
    if (this.closed) {
      return;
    }

    try {
      for (const sourceEvent of events) {
        const validation = validateHostEvent(sourceEvent);
        if (!validation.ok) {
          this.failClosed("invalid_event");
          return;
        }

        this.schedule(validation.event);
        if (this.closed) {
          return;
        }
      }
    } catch {
      this.failClosed("host_unavailable");
    }
  }

  private schedule(event: HostPresentationEvent): void {
    let cancel: (() => void) | undefined;
    let deliveredSynchronously = false;

    try {
      cancel = this.clock.schedule(0, () => {
        deliveredSynchronously = true;
        if (cancel !== undefined) {
          this.pending.delete(cancel);
        }
        if (this.closed) {
          return;
        }

        try {
          this.handlers.onEvent(event);
        } catch {
          this.failClosed("host_unavailable");
          return;
        }

        if (event.type === "session_closed") {
          this.closeNow();
        }
      });
    } catch {
      this.failClosed("host_unavailable");
      return;
    }

    if (!deliveredSynchronously && !this.closed) {
      this.pending.add(cancel);
    } else {
      cancel();
    }
  }

  private cancelPending(): void {
    const pending = [...this.pending];
    this.pending.clear();
    for (const cancel of pending) {
      try {
        cancel();
      } catch {
        // Cancellation is best-effort and never reopens a closed session.
      }
    }
  }

  private closeNow(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.cancelPending();
    this.signal.removeEventListener("abort", this.onAbort);
  }

  private failClosed(
    code: "invalid_event" | "host_unavailable",
  ): void {
    if (this.closed) {
      return;
    }

    this.cancelPending();
    try {
      this.handlers.onFatalError(code);
    } finally {
      this.closeNow();
    }
  }
}

export class FakePresentationHost implements PresentationHostAdapter {
  constructor(
    private readonly script: FakePresentationScript,
    private readonly clock: FakeClock,
  ) {}

  readonly connect = (
    handlers: PresentationHostHandlers,
    signal: AbortSignal,
  ): Promise<PresentationSession> => Promise.resolve(
    new FakePresentationSession(this.script, this.clock, handlers, signal),
  );
}
