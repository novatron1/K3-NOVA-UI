import type { HostRunPhase } from "../domain/presentation-types";

export interface NovaCoreProps {
  readonly phase: HostRunPhase;
  readonly statusLabel: string;
  readonly voiceAvailable: boolean;
  readonly onVoiceStart: () => void;
  readonly onVoiceStop: () => void;
}

export function NovaCore({
  phase,
  statusLabel,
  voiceAvailable,
  onVoiceStart,
  onVoiceStop,
}: NovaCoreProps) {
  const listening = phase === "listening";
  const voiceLabel = voiceAvailable
    ? listening
      ? "Stop voice capture"
      : "Start voice capture"
    : "Voice capture unavailable";

  return (
    <section aria-label="Nova core">
      <button
        type="button"
        data-phase={phase}
        disabled={!voiceAvailable}
        aria-disabled={!voiceAvailable}
        aria-label={voiceLabel}
        onClick={listening ? onVoiceStop : onVoiceStart}
      >
        <span aria-hidden="true" data-core-layer="outer-membrane" />
        <span aria-hidden="true" data-core-layer="neural-lattice" />
        <span aria-hidden="true" data-core-layer="luminous-nucleus" />
      </button>
      <p aria-label="Nova status">
        {statusLabel}
      </p>
    </section>
  );
}
