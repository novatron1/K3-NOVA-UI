import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import type { HostPresentationEvent } from "../domain/presentation-events";
import type {
  TrustedPermissionGate,
} from "../domain/presentation-types";
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

function containOperation(operation: () => Promise<void>): Promise<void> {
  try {
    return Promise.resolve(operation()).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
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
  readonly onPermissionDecision: (
    approvalRequestId: string,
    decision: "approve" | "deny" | "cancel",
  ) => Promise<void>;
  readonly onCancel: () => Promise<void>;
}

export type PresentationController =
  & PresentationState
  & PresentationControllerActions;

interface ControllerRuntime {
  readonly abortController: AbortController;
  readonly voiceCapture: VoiceCaptureAdapter;
  active: boolean;
  terminated: boolean;
  cancelRequested: boolean;
  session: PresentationSession | null;
  sessionTeardownIntent: "cancel" | "close" | null;
  sessionTeardown: Promise<void> | null;
  voiceTeardown: Promise<void> | null;
  aborted: boolean;
  permissionGate: TrustedPermissionGate | null;
  readonly decidedPermissionRequests: Set<string>;
}

function abortOnce(runtime: ControllerRuntime): void {
  if (runtime.aborted) {
    return;
  }

  runtime.aborted = true;
  runtime.abortController.abort();
}

function requestSessionTeardown(
  runtime: ControllerRuntime,
  intent: "cancel" | "close",
): Promise<void> {
  if (
    runtime.sessionTeardownIntent === null
    || (intent === "cancel" && runtime.sessionTeardown === null)
  ) {
    runtime.sessionTeardownIntent = intent;
  }

  if (runtime.session === null) {
    return Promise.resolve();
  }

  if (runtime.sessionTeardown === null) {
    const connectedSession = runtime.session;
    const teardownIntent = runtime.sessionTeardownIntent ?? intent;
    runtime.sessionTeardown = containOperation(() => (
      teardownIntent === "cancel"
        ? connectedSession.cancel()
        : connectedSession.close()
    ));
  }

  return runtime.sessionTeardown;
}

function requestVoiceTeardown(runtime: ControllerRuntime): Promise<void> {
  if (runtime.voiceTeardown === null) {
    runtime.voiceTeardown = containOperation(
      () => runtime.voiceCapture.cancel(),
    );
  }

  return runtime.voiceTeardown;
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
  const draftRef = useRef(state.draft);
  const voiceReviewRef = useRef(state.voiceReview);
  const runtimeRef = useRef<ControllerRuntime | null>(null);
  const textSubmissionPending = useRef(false);
  const voiceSubmissionPending = useRef(false);
  const voiceStopPending = useRef(false);
  const voiceStopGeneration = useRef(0);

  useEffect(() => {
    const abortController = new AbortController();
    const runtime: ControllerRuntime = {
      abortController,
      voiceCapture,
      active: true,
      terminated: false,
      cancelRequested: false,
      session: null,
      sessionTeardownIntent: null,
      sessionTeardown: null,
      voiceTeardown: null,
      aborted: false,
      permissionGate: null,
      decidedPermissionRequests: new Set(),
    };
    runtimeRef.current = runtime;

    const cleanupAdapters = (intent: "cancel" | "close"): void => {
      abortOnce(runtime);
      void requestVoiceTeardown(runtime);
      void requestSessionTeardown(runtime, intent);
    };

    const terminate = (
      code: "invalid_event" | "host_unavailable",
    ): void => {
      if (!runtime.active || runtime.terminated) {
        return;
      }

      runtime.terminated = true;
      dispatch({ type: "host_event", event: failureEvent(code) });
      cleanupAdapters("close");
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
            cleanupAdapters("close");
            return;
          }

          if (validation.event.type === "snapshot") {
            runtime.permissionGate = validation.event.snapshot.permissionGate;
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
          runtime.session = connectedSession;
          if (
            !runtime.active
            || runtime.terminated
            || runtime.sessionTeardownIntent !== null
          ) {
            void requestSessionTeardown(
              runtime,
              runtime.cancelRequested ? "cancel" : "close",
            );
            return;
          }
        },
        () => {
          terminate("host_unavailable");
        },
      );
    }

    return () => {
      runtime.active = false;
      runtime.terminated = true;
      voiceStopGeneration.current += 1;
      voiceStopPending.current = false;
      cleanupAdapters(runtime.cancelRequested ? "cancel" : "close");
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, [host, voiceCapture]);

  const onDraftChange = useCallback((value: string): void => {
    draftRef.current = value;
    dispatch({ type: "draft_changed", value });
  }, []);

  const onSubmitText = useCallback(async (): Promise<void> => {
    const runtime = runtimeRef.current;
    const draft = draftRef.current;
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
      if (runtime.active && !runtime.terminated) {
        if (draftRef.current === draft) {
          draftRef.current = "";
        }
        dispatch({
          type: "draft_submission_resolved",
          submittedValue: draft,
        });
      }
    } finally {
      textSubmissionPending.current = false;
    }
  }, []);

  const onSubmitVoiceReview = useCallback(async (): Promise<void> => {
    const runtime = runtimeRef.current;
    const voiceReview = voiceReviewRef.current;
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
      if (runtime.active && !runtime.terminated) {
        if (voiceReviewRef.current === voiceReview) {
          voiceReviewRef.current = null;
        }
        dispatch({
          type: "voice_review_submission_resolved",
          submittedValue: voiceReview,
        });
      }
    } finally {
      voiceSubmissionPending.current = false;
    }
  }, []);

  const onDiscardVoiceReview = useCallback((): void => {
    voiceReviewRef.current = null;
    dispatch({ type: "voice_review_changed", value: null });
  }, []);

  const onVoiceStart = useCallback((): void => {
    const runtime = runtimeRef.current;
    if (
      !voiceCapture.available
      || runtime === null
      || !runtime.active
      || runtime.terminated
      || voiceStopPending.current
      || voiceReviewRef.current !== null
    ) {
      return;
    }

    voiceStopGeneration.current += 1;
    ignoreFailure(() => voiceCapture.start(runtime.abortController.signal));
  }, [voiceCapture]);

  const onVoiceStop = useCallback((): void => {
    const runtime = runtimeRef.current;
    if (
      !voiceCapture.available
      || runtime === null
      || !runtime.active
      || runtime.terminated
      || voiceStopPending.current
      || voiceReviewRef.current !== null
    ) {
      return;
    }

    voiceStopPending.current = true;
    const generation = voiceStopGeneration.current + 1;
    voiceStopGeneration.current = generation;
    let stop: Promise<string>;
    try {
      stop = Promise.resolve(voiceCapture.stopForReview());
    } catch {
      voiceStopPending.current = false;
      return;
    }

    void stop.then(
      (transcript) => {
        if (
          runtime.active
          && !runtime.terminated
          && voiceStopGeneration.current === generation
          && voiceReviewRef.current === null
        ) {
          voiceReviewRef.current = transcript;
          dispatch({ type: "voice_review_changed", value: transcript });
        }
      },
      () => undefined,
    ).finally(() => {
      if (voiceStopGeneration.current === generation) {
        voiceStopPending.current = false;
      }
    });
  }, [voiceCapture]);

  const onPermissionDecision = useCallback((
    approvalRequestId: string,
    decision: "approve" | "deny" | "cancel",
  ): Promise<void> => {
    const runtime = runtimeRef.current;
    if (
      runtime === null
      || !runtime.active
      || runtime.terminated
    ) {
      return Promise.resolve();
    }

    const gate = runtime.permissionGate;
    const session = runtime.session;
    if (
      gate === null
      || session === null
      || gate.approvalRequestId !== approvalRequestId
      || !gate.choices.includes(decision)
      || runtime.decidedPermissionRequests.has(approvalRequestId)
    ) {
      return Promise.resolve();
    }

    runtime.decidedPermissionRequests.add(approvalRequestId);
    return containOperation(
      () => session.decidePermission(approvalRequestId, decision),
    );
  }, []);

  const onCancel = useCallback(async (): Promise<void> => {
    const runtime = runtimeRef.current;
    if (runtime === null || !runtime.active || runtime.terminated) {
      return;
    }

    runtime.cancelRequested = true;
    runtime.terminated = true;
    voiceStopGeneration.current += 1;
    voiceStopPending.current = false;
    const sessionCancellation = requestSessionTeardown(runtime, "cancel");
    abortOnce(runtime);
    const voiceCancellation = requestVoiceTeardown(runtime);
    dispatch({
      type: "host_event",
      event: { type: "session_closed", reason: "cancelled" },
    });
    await Promise.allSettled([sessionCancellation, voiceCancellation]);
  }, []);

  const actions = useMemo<PresentationControllerActions>(() => ({
    voiceAvailable: voiceCapture.available,
    onDraftChange,
    onSubmitText,
    onSubmitVoiceReview,
    onDiscardVoiceReview,
    onVoiceStart,
    onVoiceStop,
    onPermissionDecision,
    onCancel,
  }), [
    onCancel,
    onDiscardVoiceReview,
    onDraftChange,
    onPermissionDecision,
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
