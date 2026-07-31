import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import type { HostPresentationEvent } from "../domain/presentation-events";
import type {
  PresentationHostAdapter,
  PresentationSession,
} from "../host/presentation-host";
import { validateHostEvent } from "../security/validate-host-event";
import type { VoiceCaptureAdapter } from "../voice/voice-capture";
import {
  createInitialPresentationState,
  presentationReducer,
  type PresentationState,
} from "./presentation-reducer";

const FAILURE_LABELS = Object.freeze({
  invalid_event: "The presentation host sent an invalid event.",
  host_unavailable: "The presentation host is unavailable.",
});

function ignoreFailure(operation: () => Promise<void>): void {
  try {
    void operation().catch(() => undefined);
  } catch {
    // Cleanup failures cannot update an unmounted presentation.
  }
}

function failureEvent(
  code: "invalid_event" | "host_unavailable",
): HostPresentationEvent {
  return Object.freeze({
    type: "session_error",
    code,
    label: FAILURE_LABELS[code],
  });
}

export interface PresentationControllerActions {
  readonly voiceAvailable: boolean;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmitText: () => Promise<void>;
  readonly onSubmitVoiceReview: () => Promise<void>;
  readonly onDiscardVoiceReview: () => void;
  readonly onVoiceStart: () => void;
  readonly onVoiceStop: () => void;
  readonly onCancel: () => Promise<void>;
}

export type PresentationController =
  & PresentationState
  & PresentationControllerActions;

interface ControllerRuntime {
  readonly abortController: AbortController;
  active: boolean;
  terminated: boolean;
  session: PresentationSession | null;
}

export function usePresentationController(
  host: PresentationHostAdapter,
  voiceCapture: VoiceCaptureAdapter,
): PresentationController {
  const [state, dispatch] = useReducer(
    presentationReducer,
    undefined,
    createInitialPresentationState,
  );
  const stateRef = useRef(state);
  const runtimeRef = useRef<ControllerRuntime | null>(null);
  const textSubmissionPending = useRef(false);
  const voiceSubmissionPending = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const abortController = new AbortController();
    const runtime: ControllerRuntime = {
      abortController,
      active: true,
      terminated: false,
      session: null,
    };
    runtimeRef.current = runtime;

    const cleanupAdapters = (): void => {
      abortController.abort();
      ignoreFailure(() => voiceCapture.cancel());
      if (runtime.session !== null) {
        const connectedSession = runtime.session;
        ignoreFailure(() => connectedSession.close());
      }
    };

    const terminate = (
      code: "invalid_event" | "host_unavailable",
    ): void => {
      if (!runtime.active || runtime.terminated) {
        return;
      }

      runtime.terminated = true;
      dispatch({ type: "host_event", event: failureEvent(code) });
      cleanupAdapters();
    };

    let connection: Promise<PresentationSession> | null = null;
    try {
      connection = host.connect({
        onEvent: (candidate) => {
          if (!runtime.active || runtime.terminated) {
            return;
          }

          const validation = validateHostEvent(candidate);
          if (!validation.ok) {
            terminate("invalid_event");
            return;
          }

          if (validation.event.type === "session_closed") {
            runtime.terminated = true;
            dispatch({ type: "host_event", event: validation.event });
            cleanupAdapters();
            return;
          }

          dispatch({ type: "host_event", event: validation.event });
        },
        onFatalError: terminate,
      }, abortController.signal);
    } catch {
      terminate("host_unavailable");
    }

    if (connection !== null) {
      void connection.then(
        (connectedSession) => {
          if (!runtime.active || runtime.terminated) {
            ignoreFailure(() => connectedSession.close());
            return;
          }
          runtime.session = connectedSession;
        },
        () => {
          terminate("host_unavailable");
        },
      );
    }

    return () => {
      runtime.active = false;
      runtime.terminated = true;
      cleanupAdapters();
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, [host, voiceCapture]);

  const onDraftChange = useCallback((value: string): void => {
    dispatch({ type: "draft_changed", value });
  }, []);

  const onSubmitText = useCallback(async (): Promise<void> => {
    const runtime = runtimeRef.current;
    const draft = stateRef.current.draft;
    if (
      runtime === null
      || !runtime.active
      || runtime.terminated
      || runtime.session === null
      || draft.trim().length === 0
      || textSubmissionPending.current
    ) {
      return;
    }

    textSubmissionPending.current = true;
    try {
      await runtime.session.submitText(draft);
      if (
        runtime.active
        && !runtime.terminated
        && stateRef.current.draft === draft
      ) {
        dispatch({ type: "draft_changed", value: "" });
      }
    } finally {
      textSubmissionPending.current = false;
    }
  }, []);

  const onSubmitVoiceReview = useCallback(async (): Promise<void> => {
    const runtime = runtimeRef.current;
    const voiceReview = stateRef.current.voiceReview;
    if (
      runtime === null
      || !runtime.active
      || runtime.terminated
      || runtime.session === null
      || voiceReview === null
      || voiceSubmissionPending.current
    ) {
      return;
    }

    voiceSubmissionPending.current = true;
    try {
      await runtime.session.submitVoiceTranscript(voiceReview);
      if (
        runtime.active
        && !runtime.terminated
        && stateRef.current.voiceReview === voiceReview
      ) {
        dispatch({ type: "voice_review_changed", value: null });
      }
    } finally {
      voiceSubmissionPending.current = false;
    }
  }, []);

  const onDiscardVoiceReview = useCallback((): void => {
    dispatch({ type: "voice_review_changed", value: null });
  }, []);

  const onVoiceStart = useCallback((): void => {
    const runtime = runtimeRef.current;
    if (
      !voiceCapture.available
      || runtime === null
      || !runtime.active
      || runtime.terminated
    ) {
      return;
    }

    ignoreFailure(() => voiceCapture.start(runtime.abortController.signal));
  }, [voiceCapture]);

  const onVoiceStop = useCallback((): void => {
    const runtime = runtimeRef.current;
    if (
      !voiceCapture.available
      || runtime === null
      || !runtime.active
      || runtime.terminated
    ) {
      return;
    }

    void voiceCapture.stopForReview().then(
      (transcript) => {
        if (runtime.active && !runtime.terminated) {
          dispatch({ type: "voice_review_changed", value: transcript });
        }
      },
      () => undefined,
    );
  }, [voiceCapture]);

  const onCancel = useCallback(async (): Promise<void> => {
    const runtime = runtimeRef.current;
    if (runtime === null || !runtime.active || runtime.terminated) {
      return;
    }

    runtime.terminated = true;
    const sessionCancellation = runtime.session === null
      ? Promise.resolve()
      : runtime.session.cancel();
    runtime.abortController.abort();
    const voiceCancellation = voiceCapture.cancel();
    await Promise.allSettled([sessionCancellation, voiceCancellation]);
  }, [voiceCapture]);

  const actions = useMemo<PresentationControllerActions>(() => ({
    voiceAvailable: voiceCapture.available,
    onDraftChange,
    onSubmitText,
    onSubmitVoiceReview,
    onDiscardVoiceReview,
    onVoiceStart,
    onVoiceStop,
    onCancel,
  }), [
    onCancel,
    onDiscardVoiceReview,
    onDraftChange,
    onSubmitText,
    onSubmitVoiceReview,
    onVoiceStart,
    onVoiceStop,
    voiceCapture.available,
  ]);

  return useMemo(
    () => ({ ...state, ...actions }),
    [actions, state],
  );
}
