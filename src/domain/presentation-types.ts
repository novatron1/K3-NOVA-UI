export const HOST_RUN_PHASES = Object.freeze([
  "idle",
  "listening",
  "input_review",
  "processing",
  "responding",
  "approval_required",
  "deterministic_deny",
  "paused",
  "cancelled",
  "unavailable",
] as const);

export type HostRunPhase = (typeof HOST_RUN_PHASES)[number];

export type TrustTone =
  | "trusted_local"
  | "explicit_cloud"
  | "approval_required"
  | "deterministic_deny"
  | "fail_closed";

export type MessageAuthor = "user" | "nova";
export type PrivacyClass = "public" | "internal" | "private" | "restricted";
export type IsolationLevel = "strong" | "degraded" | "unavailable";
export type EvidenceState =
  | "not_requested"
  | "pending"
  | "verified"
  | "verified_with_warnings"
  | "failed"
  | "blocked";
export type RollbackState =
  | "not_required"
  | "checkpointed"
  | "restoring"
  | "verified"
  | "failed";

export interface UntrustedMessage {
  readonly id: string;
  readonly author: MessageAuthor;
  readonly text: string;
  readonly createdAt: string;
}

export interface TrustedPermissionGate {
  readonly approvalRequestId: string;
  readonly kind: "permission" | "cloud_consent" | "privacy_review";
  readonly actionLabel: string;
  readonly canonicalResource: string;
  readonly policyLabels: readonly string[];
  readonly reasonLabels: readonly string[];
  readonly requiredPermission: string;
  readonly actualPermission: string;
  readonly irreversible: boolean;
  readonly choices: readonly ("approve" | "deny" | "cancel")[];
}

export interface SanitizedHostSnapshot {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly phase: HostRunPhase;
  readonly trustTone: TrustTone;
  readonly statusLabel: string;
  readonly providerLabel: string;
  readonly modelLabel: string;
  readonly privacyClass: PrivacyClass;
  readonly cloudConsentRequired: boolean;
  readonly cloudConsentGranted: boolean;
  readonly isolation: IsolationLevel;
  readonly isolationLabel: string;
  readonly contractSummary: readonly string[];
  readonly permissionSummary: readonly string[];
  readonly ledgerSummary: readonly string[];
  readonly evidence: EvidenceState;
  readonly evidenceLabel: string;
  readonly budgetSummary: readonly string[];
  readonly observerSummary: readonly string[];
  readonly rollback: RollbackState;
  readonly rollbackLabel: string;
  readonly permissionGate: TrustedPermissionGate | null;
}

export type LivingOrganId =
  | "contract"
  | "permissions"
  | "ledger"
  | "evidence"
  | "provider"
  | "privacy"
  | "budgets"
  | "isolation"
  | "observer"
  | "rollback";

export type DisplayPreferenceKey =
  | "reducedMotion"
  | "audioVolume"
  | "layoutDensity"
  | "themeIntensity";

export interface DisplayPreferences {
  readonly reducedMotion: boolean;
  readonly audioVolume: number;
  readonly layoutDensity: "balanced" | "compact";
  readonly themeIntensity: number;
}

export function createUnavailableSnapshot(): SanitizedHostSnapshot {
  const snapshot: SanitizedHostSnapshot = {
    schemaVersion: 1,
    runId: "unavailable",
    phase: "unavailable",
    trustTone: "fail_closed",
    statusLabel: "NovaMind host unavailable",
    providerLabel: "Unavailable",
    modelLabel: "Unavailable",
    privacyClass: "private",
    cloudConsentRequired: false,
    cloudConsentGranted: false,
    isolation: "unavailable",
    isolationLabel: "Unavailable",
    contractSummary: Object.freeze([]),
    permissionSummary: Object.freeze([]),
    ledgerSummary: Object.freeze([]),
    evidence: "blocked",
    evidenceLabel: "Unavailable",
    budgetSummary: Object.freeze([]),
    observerSummary: Object.freeze([]),
    rollback: "not_required",
    rollbackLabel: "Unavailable",
    permissionGate: null,
  };

  return Object.freeze(snapshot);
}
