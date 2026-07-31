import { NovaCore } from "../components/NovaCore";
import { ConversationField } from "../components/ConversationField";
import { ComposerMembrane } from "../components/ComposerMembrane";
import { PermissionGate } from "../components/PermissionGate";
import { StatusAnnouncer } from "../components/StatusAnnouncer";
import { TrustHalo } from "../components/TrustHalo";
import {
  trustedActivePermissionGate,
  type TrustTone,
} from "../domain/presentation-types";
import type { PresentationState } from "../state/presentation-reducer";
import type {
  PresentationControllerActions,
} from "../state/use-presentation-controller";
import styles from "./NovaMindApp.module.css";

export interface NovaMindAppProps {
  readonly state: PresentationState;
  readonly controller?: PresentationControllerActions;
}

const TRUST_LABELS: Readonly<Record<TrustTone, string>> = Object.freeze({
  trusted_local: "Trusted local",
  explicit_cloud: "Explicit cloud",
  approval_required: "Approval required",
  deterministic_deny: "Deterministic deny",
  fail_closed: "Fail closed",
});

const UNAVAILABLE_CONTROLLER: PresentationControllerActions = Object.freeze({
  voiceAvailable: false,
  onDraftChange: () => {},
  onSubmitText: () => Promise.resolve(),
  onSubmitVoiceReview: () => Promise.resolve(),
  onDiscardVoiceReview: () => {},
  onVoiceStart: () => {},
  onVoiceStop: () => {},
  onPermissionDecision: () => Promise.resolve(),
  onCancel: () => Promise.resolve(),
});

export function NovaMindApp({
  state,
  controller = UNAVAILABLE_CONTROLLER,
}: NovaMindAppProps) {
  const { snapshot } = state;
  const sessionTerminal = state.sessionState === "closed"
    || state.sessionState === "failed";
  const visibleMessages = snapshot.phase === "processing"
    ? state.messages.filter((message) => message.author === "user")
    : state.messages;
  const permissionGate = sessionTerminal
    ? null
    : trustedActivePermissionGate(snapshot);

  return (
    <main
      className={`${styles.novaMindApp} nova-shell`}
      data-phase={snapshot.phase}
      data-trust-tone={snapshot.trustTone}
    >
      <div
        className="nova-presentation"
        inert={permissionGate === null ? undefined : true}
        aria-hidden={permissionGate === null ? undefined : true}
      >
        <header className="nova-header">
          <div>
            <p className="nova-eyebrow">K3 cognitive interface</p>
            <h1>NovaMind</h1>
          </div>
          <TrustHalo
            tone={snapshot.trustTone}
            label={TRUST_LABELS[snapshot.trustTone]}
            providerLabel={snapshot.providerLabel}
            privacyClass={snapshot.privacyClass}
          />
        </header>

        <section className="nova-shrine" aria-labelledby="shrine-title">
          <div className="nova-shrine-heading">
            <p>Sanitized host presentation</p>
            <h2 id="shrine-title">Neural Shrine</h2>
          </div>
          <div className="nova-core">
            <NovaCore
              phase={snapshot.phase}
              statusLabel={snapshot.statusLabel}
              voiceAvailable={controller.voiceAvailable}
              onVoiceStart={controller.onVoiceStart}
              onVoiceStop={controller.onVoiceStop}
            />
          </div>
        </section>

        <section
          className="nova-conversation"
          aria-label="Conversation"
        >
          <ConversationField messages={visibleMessages} />
        </section>

        <ComposerMembrane
          draft={state.draft}
          voiceReview={state.voiceReview}
          privacyClass={snapshot.privacyClass}
          cloudConsentRequired={snapshot.cloudConsentRequired}
          busy={snapshot.phase === "processing" && !sessionTerminal}
          voiceAvailable={controller.voiceAvailable}
          onDraftChange={controller.onDraftChange}
          onSubmitText={controller.onSubmitText}
          onSubmitVoiceReview={controller.onSubmitVoiceReview}
          onDiscardVoiceReview={controller.onDiscardVoiceReview}
          onCancel={controller.onCancel}
        />

        <div className="nova-announcer">
          <StatusAnnouncer
            phase={snapshot.phase}
            statusLabel={snapshot.statusLabel}
          />
        </div>
      </div>

      {permissionGate === null
        ? null
        : (
            <PermissionGate
              key={permissionGate.approvalRequestId}
              gate={permissionGate}
              onDecision={controller.onPermissionDecision}
            />
          )}
    </main>
  );
}
