export interface VoiceCaptureAdapter {
  readonly available: boolean;
  readonly start: (signal: AbortSignal) => Promise<void>;
  readonly stopForReview: () => Promise<string>;
  readonly cancel: () => Promise<void>;
}

const UNAVAILABLE_MESSAGE = "Voice capture is unavailable.";

export class UnavailableVoiceCapture implements VoiceCaptureAdapter {
  readonly available = false;

  async start(signal: AbortSignal): Promise<void> {
    void signal;
    throw new Error(UNAVAILABLE_MESSAGE);
  }

  async stopForReview(): Promise<string> {
    throw new Error(UNAVAILABLE_MESSAGE);
  }

  async cancel(): Promise<void> {}
}
