import type {
  LocalModelInventory,
  LocalModelSelection,
  LocalModelStatus,
} from "../domain/local-models";
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

const DEMO_DOLPHIN_ID = `local_${"a".repeat(64)}`;
const DEMO_NOVA_ID = `local_${"b".repeat(64)}`;

function demoInventory(
  selection: LocalModelSelection,
  version: number,
): LocalModelInventory {
  return Object.freeze({
    version,
    scannedAt: "2026-08-16T18:20:00+00:00",
    selection,
    models: Object.freeze([
      Object.freeze({
        modelId: DEMO_DOLPHIN_ID,
        displayName: "Dolphin Mixtral 8x7B",
        engine: "ollama" as const,
        source: "ollama" as const,
        sizeBytes: 31_000_000_000,
        parameterCount: 47_000_000_000,
        quantization: "Q4_0",
        contextLength: 32_768,
        capabilities: Object.freeze({
          text: true,
          vision: false,
          tools: false,
          embeddings: false,
          reasoning: false,
        }),
        runtimeState: "ready" as const,
        failureCode: null,
      }),
      Object.freeze({
        modelId: DEMO_NOVA_ID,
        displayName: "Nova Trained 1.5B",
        engine: "ollama" as const,
        source: "ollama" as const,
        sizeBytes: 986_000_000,
        parameterCount: 1_500_000_000,
        quantization: "Q4_K_M",
        contextLength: 32_768,
        capabilities: Object.freeze({
          text: true,
          vision: false,
          tools: true,
          embeddings: false,
          reasoning: false,
        }),
        runtimeState: "ready" as const,
        failureCode: null,
      }),
    ]),
  });
}

class FakePresentationSession implements PresentationSession {
  private readonly pending = new Set<() => void>();
  private closed = false;
  private localModelSelection: LocalModelSelection = Object.freeze({
    mode: "auto-local",
    modelId: null,
  });
  private localModelVersion = 1;
  private answeringModel: LocalModelStatus["answeringModel"] = null;

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

    const selectedId = this.localModelSelection.mode === "manual-local"
      ? this.localModelSelection.modelId
      : DEMO_DOLPHIN_ID;
    this.answeringModel = Object.freeze({
      modelId: selectedId,
      displayName: selectedId === DEMO_NOVA_ID
        ? "Nova Trained 1.5B"
        : "Dolphin Mixtral 8x7B",
      engine: "ollama",
    });
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

  readonly getLocalModels = (): Promise<LocalModelInventory> => Promise.resolve(
    demoInventory(this.localModelSelection, this.localModelVersion),
  );

  readonly scanLocalModels = (): Promise<LocalModelInventory> => {
    this.localModelVersion += 1;
    return Promise.resolve(
      demoInventory(this.localModelSelection, this.localModelVersion),
    );
  };

  readonly setLocalModelSelection = (
    selection: LocalModelSelection,
  ): Promise<LocalModelInventory> => {
    if (
      selection.mode === "manual-local"
      && selection.modelId !== DEMO_DOLPHIN_ID
      && selection.modelId !== DEMO_NOVA_ID
    ) {
      return Promise.reject(new Error("local model selection unavailable"));
    }
    this.localModelSelection = Object.freeze({ ...selection });
    this.answeringModel = null;
    return Promise.resolve(
      demoInventory(this.localModelSelection, this.localModelVersion),
    );
  };

  readonly getLocalModelStatus = (): Promise<LocalModelStatus> => Promise.resolve(
    Object.freeze({
      selection: this.localModelSelection,
      answeringModel: this.answeringModel,
    }),
  );

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

        if (event.type === "session_closed") {
          this.closeNow();
        }

        try {
          this.handlers.onEvent(event);
        } catch {
          this.failClosed("host_unavailable");
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

    this.closed = true;
    this.cancelPending();
    this.signal.removeEventListener("abort", this.onAbort);
    try {
      this.handlers.onFatalError(code);
    } catch {
      // External fatal handlers cannot reopen or destabilize the session.
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
