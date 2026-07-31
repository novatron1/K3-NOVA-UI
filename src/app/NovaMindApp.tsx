import { NovaCore } from "../components/NovaCore";
import { ConversationField } from "../components/ConversationField";
import { StatusAnnouncer } from "../components/StatusAnnouncer";
import { TrustHalo } from "../components/TrustHalo";
import type { TrustTone } from "../domain/presentation-types";
import type { PresentationState } from "../state/presentation-reducer";
import "./NovaMindApp.module.css";

export interface NovaMindAppProps {
  readonly state: PresentationState;
}

const TRUST_LABELS: Readonly<Record<TrustTone, string>> = Object.freeze({
  trusted_local: "Trusted local",
  explicit_cloud: "Explicit cloud",
  approval_required: "Approval required",
  deterministic_deny: "Deterministic deny",
  fail_closed: "Fail closed",
});

function unavailableVoiceAction(): void {}

export function NovaMindApp({ state }: NovaMindAppProps) {
  const { snapshot } = state;
  const visibleMessages = snapshot.phase === "processing"
    ? state.messages.filter((message) => message.author === "user")
    : state.messages;

  return (
    <main
      className="nova-shell"
      data-phase={snapshot.phase}
      data-trust-tone={snapshot.trustTone}
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
            voiceAvailable={false}
            onVoiceStart={unavailableVoiceAction}
            onVoiceStop={unavailableVoiceAction}
          />
        </div>
      </section>

      <section
        className="nova-conversation"
        aria-label="Conversation"
      >
        <ConversationField messages={visibleMessages} />
      </section>

      <div className="nova-announcer">
        <StatusAnnouncer
          phase={snapshot.phase}
          statusLabel={snapshot.statusLabel}
        />
      </div>
    </main>
  );
}
