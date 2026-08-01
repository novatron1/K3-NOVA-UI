import type {
  PrivacyClass,
  TrustTone,
} from "../domain/presentation-types";

export interface TrustHaloProps {
  readonly tone: TrustTone;
  readonly label: string;
  readonly providerLabel: string;
  readonly privacyClass: PrivacyClass;
}

export function TrustHalo({
  tone,
  label,
  providerLabel,
  privacyClass,
}: TrustHaloProps) {
  return (
    <aside aria-label={`Trust halo: ${label}`} data-trust-tone={tone}>
      <div>
        <svg
          role="img"
          aria-label="Trust state"
          viewBox="0 0 24 24"
          width="24"
          height="24"
        >
          <path
            d="M12 2.5 20 7v10l-8 4.5L4 17V7l8-4.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="12" r="2.75" fill="currentColor" />
        </svg>
        <strong>{label}</strong>
      </div>
      <p>{providerLabel}</p>
      <p>Privacy: {privacyClass}</p>
    </aside>
  );
}
