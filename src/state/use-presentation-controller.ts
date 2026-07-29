import { useEffect, useReducer } from "react";

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

export function usePresentationController(
  host: PresentationHostAdapter,
  voiceCapture: VoiceCaptureAdapter,
): PresentationState {
  const [state, dispatch] = useReducer(
    presentationReducer,
    undefined,
    createInitialPresentationState,
  );

  useEffect(() => {
    const abortController = new AbortController();
    let active = true;
    let terminated = false;
    let session: PresentationSession | null = null;

    const terminate = (
      code: "invalid_event" | "host_unavailable",
    ): void => {
      if (!active || terminated) {
        return;
      }

      terminated = true;
      dispatch({ type: "host_event", event: failureEvent(code) });
      abortController.abort();
      ignoreFailure(() => voiceCapture.cancel());
      if (session !== null) {
        const connectedSession = session;
        ignoreFailure(() => connectedSession.close());
      }
    };

    let connection: Promise<PresentationSession> | null = null;
    try {
      connection = host.connect({
        onEvent: (candidate) => {
          if (!active || terminated) {
            return;
          }

          const validation = validateHostEvent(candidate);
          if (!validation.ok) {
            terminate("invalid_event");
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
          if (!active || terminated) {
            ignoreFailure(() => connectedSession.close());
            return;
          }
          session = connectedSession;
        },
        () => {
          terminate("host_unavailable");
        },
      );
    }

    return () => {
      active = false;
      terminated = true;
      abortController.abort();
      if (session !== null) {
        const connectedSession = session;
        ignoreFailure(() => connectedSession.close());
      }
      ignoreFailure(() => voiceCapture.cancel());
    };
  }, [host, voiceCapture]);

  return state;
}
