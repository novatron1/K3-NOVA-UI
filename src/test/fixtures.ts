import type {
  SanitizedHostSnapshot,
  TrustedPermissionGate,
} from "../domain/presentation-types";

export interface SecurityBoundaryCanonicalFixture {
  readonly scenario: "private-cloud-consent" | "timeout-rollback-failure";
  readonly snapshot: SanitizedHostSnapshot;
  readonly sessionState: "connected" | "failed";
  readonly sessionError: string | null;
}

export function makeSnapshot(
  overrides: Partial<SanitizedHostSnapshot> = {},
): SanitizedHostSnapshot {
  const permissionGate: TrustedPermissionGate | null = null;
  const defaults: SanitizedHostSnapshot = {
    schemaVersion: 1,
    runId: "run-1",
    phase: "processing",
    trustTone: "trusted_local",
    statusLabel: "Processing locally",
    providerLabel: "Local provider",
    modelLabel: "Local model",
    privacyClass: "private",
    cloudConsentRequired: false,
    cloudConsentGranted: false,
    isolation: "strong",
    isolationLabel: "Strong local isolation",
    contractSummary: ["Contract active"],
    permissionSummary: ["No approval pending"],
    ledgerSummary: ["Presentation ledger synchronized"],
    evidence: "not_requested",
    evidenceLabel: "Evidence not requested",
    budgetSummary: ["Within display budget"],
    observerSummary: ["Observer inactive"],
    rollback: "not_required",
    rollbackLabel: "Rollback not required",
    permissionGate,
  };

  return { ...defaults, ...overrides };
}

const SYNTHETIC_CLOUD_CONSENT_GATE: TrustedPermissionGate = Object.freeze({
  approvalRequestId: "synthetic-cloud-consent-7f3a",
  kind: "cloud_consent",
  actionLabel: "Synthetic cloud consent required",
  canonicalResource: "synthetic/private-cloud-action",
  policyLabels: Object.freeze(["synthetic-consent-policy"]),
  reasonLabels: Object.freeze(["Synthetic explicit cloud consent"]),
  requiredPermission: "cloud_consent",
  actualPermission: "not_granted",
  irreversible: false,
  choices: Object.freeze(["approve", "deny", "cancel"] as const),
} satisfies TrustedPermissionGate);

export const SECURITY_BOUNDARY_CANONICAL_FIXTURES: readonly SecurityBoundaryCanonicalFixture[] =
  Object.freeze([
    Object.freeze({
      scenario: "private-cloud-consent",
      snapshot: makeSnapshot({
        runId: "synthetic-private-cloud-consent-7f3a",
        phase: "approval_required",
        trustTone: "approval_required",
        statusLabel: "Synthetic cloud consent required",
        providerLabel: "Synthetic cloud provider",
        modelLabel: "Synthetic cloud model",
        privacyClass: "private",
        cloudConsentRequired: true,
        cloudConsentGranted: false,
        permissionSummary: ["Synthetic cloud consent pending"],
        permissionGate: SYNTHETIC_CLOUD_CONSENT_GATE,
      }),
      sessionState: "connected",
      sessionError: null,
    }),
    Object.freeze({
      scenario: "timeout-rollback-failure",
      snapshot: makeSnapshot({
        runId: "synthetic-timeout-rollback-91c2",
        phase: "unavailable",
        trustTone: "fail_closed",
        statusLabel: "Synthetic timeout failure; presentation fail-closed",
        providerLabel: "Unavailable",
        modelLabel: "Unavailable",
        privacyClass: "private",
        isolation: "unavailable",
        isolationLabel: "Synthetic strong isolation unavailable",
        permissionSummary: ["Synthetic timeout fail-closed"],
        evidence: "blocked",
        evidenceLabel: "Synthetic timeout blocked evidence",
        rollback: "failed",
        rollbackLabel: "Synthetic rollback failed after timeout",
      }),
      sessionState: "failed",
      sessionError: "Synthetic timeout failure",
    }),
  ]);
