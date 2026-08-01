import { useState } from "react";

import type {
  SanitizedHostSnapshot,
  TrustedPermissionGate,
} from "../domain/presentation-types";
import {
  FakePresentationHost,
  type FakeClock,
  type FakePresentationScript,
} from "../host/fake-presentation-host";
import { usePresentationController } from "../state/use-presentation-controller";
import { UnavailableVoiceCapture } from "../voice/voice-capture";
import { NovaMindApp } from "./NovaMindApp";

const MAX_DEMO_REQUEST_SEQUENCE = 10_000;

function demoPermissionGate(sequence: number): TrustedPermissionGate {
  return Object.freeze({
    approvalRequestId: `demo-approval-${sequence}`,
    kind: "permission",
    actionLabel: "Write sanitized demo output",
    canonicalResource: "workspace/demo-output.txt",
    policyLabels: Object.freeze(["fake-host-demo", "explicit-approval"]),
    reasonLabels: Object.freeze(["Explicit approval is required"]),
    requiredPermission: "write",
    actualPermission: "read",
    irreversible: true,
    choices: Object.freeze(["approve", "deny", "cancel"]),
  } satisfies TrustedPermissionGate);
}

function demoSnapshot(
  overrides: Partial<SanitizedHostSnapshot> = {},
): SanitizedHostSnapshot {
  return {
    schemaVersion: 1,
    runId: "fake-demo-run-1",
    phase: "idle",
    trustTone: "trusted_local",
    statusLabel: "Ready for a message",
    providerLabel: "Fake local host",
    modelLabel: "Demo model",
    privacyClass: "private",
    cloudConsentRequired: false,
    cloudConsentGranted: false,
    isolation: "strong",
    isolationLabel: "Strong fake-host isolation",
    contractSummary: ["Fake-host presentation contract active"],
    permissionSummary: ["No approval pending"],
    ledgerSummary: ["Sanitized demo timeline active"],
    evidence: "not_requested",
    evidenceLabel: "Evidence not requested",
    budgetSummary: ["Within demo display budget"],
    observerSummary: ["Observer inactive"],
    rollback: "not_required",
    rollbackLabel: "Rollback not required",
    permissionGate: null,
    ...overrides,
  };
}

function createDemoScript(): FakePresentationScript {
  let nextRequestSequence = 1;

  return Object.freeze({
    initialEvents: Object.freeze([{
      type: "snapshot",
      snapshot: demoSnapshot(),
    }]),
    onText: (text) => {
      if (nextRequestSequence > MAX_DEMO_REQUEST_SEQUENCE) {
        throw new Error("Fake demo request sequence exhausted");
      }

      const requestSequence = nextRequestSequence;
      nextRequestSequence += 1;
      return Object.freeze([
        {
          type: "message",
          message: {
            id: `fake-demo-user-message-${requestSequence}`,
            author: "user",
            text,
            createdAt: "2026-08-01T12:00:00.000Z",
          },
        },
        {
          type: "snapshot",
          snapshot: demoSnapshot({
            phase: "approval_required",
            trustTone: "approval_required",
            statusLabel: "Permission decision required",
            permissionSummary: ["Explicit approval pending"],
            permissionGate: demoPermissionGate(requestSequence),
          }),
        },
      ]);
    },
    onVoiceTranscript: () => Object.freeze([]),
    onPermission: (_approvalRequestId, decision) => Object.freeze([{
      type: "snapshot",
      snapshot: decision === "deny"
        ? demoSnapshot({
            phase: "deterministic_deny",
            trustTone: "deterministic_deny",
            statusLabel: "Action denied by fake host policy",
            permissionSummary: ["Denied by fake host policy"],
          })
        : decision === "cancel"
          ? demoSnapshot({
              phase: "cancelled",
              statusLabel: "Fake host presentation cancelled",
            })
          : demoSnapshot({
              phase: "responding",
              statusLabel: "Fake host approval recorded",
              permissionSummary: ["Approved by fake host"],
            }),
    }]),
  } satisfies FakePresentationScript);
}

const BROWSER_CLOCK: FakeClock = Object.freeze({
  schedule: (delayMs, callback) => {
    const timeoutId = window.setTimeout(callback, delayMs);
    return () => {
      window.clearTimeout(timeoutId);
    };
  },
} satisfies FakeClock);

export function NovaMindDemo() {
  const [host] = useState(
    () => new FakePresentationHost(createDemoScript(), BROWSER_CLOCK),
  );
  const [voice] = useState(() => new UnavailableVoiceCapture());
  const controller = usePresentationController(host, voice);

  return <NovaMindApp state={controller} controller={controller} />;
}
