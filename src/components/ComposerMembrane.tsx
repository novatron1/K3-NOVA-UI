import { useRef, useState } from "react";

import type { PrivacyClass } from "../domain/presentation-types";

export interface ComposerMembraneProps {
  readonly draft: string;
  readonly voiceReview: string | null;
  readonly privacyClass: PrivacyClass;
  readonly cloudConsentRequired: boolean;
  readonly busy: boolean;
  readonly voiceAvailable: boolean;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmitText: () => Promise<void>;
  readonly onSubmitVoiceReview: () => Promise<void>;
  readonly onDiscardVoiceReview: () => void;
  readonly onCancel: () => Promise<void>;
}

export function ComposerMembrane({
  draft,
  voiceReview,
  privacyClass,
  cloudConsentRequired,
  busy,
  voiceAvailable,
  onDraftChange,
  onSubmitText,
  onSubmitVoiceReview,
  onDiscardVoiceReview,
  onCancel,
}: ComposerMembraneProps) {
  const textSubmissionPending = useRef(false);
  const voiceSubmissionPending = useRef(false);
  const [submittingText, setSubmittingText] = useState(false);
  const [submittingVoice, setSubmittingVoice] = useState(false);

  const submitText = async (): Promise<void> => {
    if (
      busy
      || draft.trim().length === 0
      || textSubmissionPending.current
    ) {
      return;
    }

    textSubmissionPending.current = true;
    setSubmittingText(true);
    try {
      await onSubmitText();
    } finally {
      textSubmissionPending.current = false;
      setSubmittingText(false);
    }
  };

  const submitVoiceReview = async (): Promise<void> => {
    if (
      busy
      || voiceReview === null
      || voiceSubmissionPending.current
    ) {
      return;
    }

    voiceSubmissionPending.current = true;
    setSubmittingVoice(true);
    try {
      await onSubmitVoiceReview();
    } finally {
      voiceSubmissionPending.current = false;
      setSubmittingVoice(false);
    }
  };

  return (
    <section className="composer-membrane" aria-label="Message composer">
      <div className="composer-privacy" id="composer-privacy">
        <span>Privacy: {privacyClass}</span>
        {cloudConsentRequired
          ? <span>Cloud consent required before submission</span>
          : <span>No cloud consent required</span>}
      </div>

      {voiceReview === null
        ? null
        : (
          <section
            className="composer-voice-review nova-critical-surface"
            aria-label="Voice transcript review"
          >
            <h3>Review voice transcript</h3>
            <p>{voiceReview}</p>
            <div className="composer-actions">
              <button
                type="button"
                disabled={busy || submittingVoice}
                onClick={() => {
                  void submitVoiceReview();
                }}
              >
                Confirm voice transcript
              </button>
              <button
                type="button"
                disabled={busy || submittingVoice}
                onClick={onDiscardVoiceReview}
              >
                Discard voice transcript
              </button>
            </div>
          </section>
        )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submitText();
        }}
      >
        <label htmlFor="composer-draft">Message</label>
        <textarea
          id="composer-draft"
          value={draft}
          disabled={busy}
          aria-describedby="composer-privacy"
          onChange={(event) => {
            onDraftChange(event.currentTarget.value);
          }}
        />
        <div className="composer-actions">
          <button
            type="submit"
            disabled={busy || submittingText || draft.trim().length === 0}
          >
            Send message
          </button>
          <button
            type="button"
            disabled={!voiceAvailable}
            aria-disabled={!voiceAvailable}
            aria-label={voiceAvailable
              ? "Voice capture available from Nova core"
              : "Voice capture unavailable"}
          >
            {voiceAvailable ? "Voice available" : "Voice unavailable"}
          </button>
          <button
            type="button"
            className="composer-cancel"
            onClick={() => {
              void onCancel();
            }}
          >
            Cancel presentation
          </button>
        </div>
      </form>
    </section>
  );
}
