import type {
  SanitizedHostSnapshot,
  TrustedPermissionGate,
} from "../domain/presentation-types";

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
