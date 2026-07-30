import type { HostRunPhase } from "../domain/presentation-types";

export interface StatusAnnouncerProps {
  readonly phase: HostRunPhase;
  readonly statusLabel: string;
}

export function StatusAnnouncer({
  phase,
  statusLabel,
}: StatusAnnouncerProps) {
  if (phase === "deterministic_deny") {
    return (
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {statusLabel}
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {statusLabel}
    </div>
  );
}
