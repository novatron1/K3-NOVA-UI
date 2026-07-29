export interface PresentationHostHandlers {
  readonly onEvent: (event: unknown) => void;
  readonly onFatalError: (
    code: "invalid_event" | "host_unavailable",
  ) => void;
}

export interface PresentationSession {
  readonly submitText: (text: string) => Promise<void>;
  readonly submitVoiceTranscript: (transcript: string) => Promise<void>;
  readonly decidePermission: (
    approvalRequestId: string,
    decision: "approve" | "deny" | "cancel",
  ) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface PresentationHostAdapter {
  readonly connect: (
    handlers: PresentationHostHandlers,
    signal: AbortSignal,
  ) => Promise<PresentationSession>;
}
