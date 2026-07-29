import type { HostPresentationEvent } from "../domain/presentation-events";
import {
  HOST_RUN_PHASES,
  type EvidenceState,
  type HostRunPhase,
  type IsolationLevel,
  type MessageAuthor,
  type PrivacyClass,
  type RollbackState,
  type SanitizedHostSnapshot,
  type TrustTone,
  type TrustedPermissionGate,
  type UntrustedMessage,
} from "../domain/presentation-types";

export const MAX_STATUS_LABEL_CHARS = 160;
export const MAX_MESSAGE_CHARS = 200_000;
export const MAX_SUMMARY_ITEMS = 64;
export const MAX_SUMMARY_ITEM_CHARS = 240;
export const MAX_POLICY_LABELS = 32;

export type HostEventValidation =
  | { readonly ok: true; readonly event: HostPresentationEvent }
  | {
      readonly ok: false;
      readonly reason:
        | "malformed"
        | "unknown_type"
        | "unsupported_schema"
        | "oversized";
    };

type FailureReason = HostEventValidation & { readonly ok: false };

class InvalidHostEvent extends Error {
  constructor(readonly reason: FailureReason["reason"]) {
    super(reason);
  }
}

const SNAPSHOT_KEYS = [
  "schemaVersion",
  "runId",
  "phase",
  "trustTone",
  "statusLabel",
  "providerLabel",
  "modelLabel",
  "privacyClass",
  "cloudConsentRequired",
  "cloudConsentGranted",
  "isolation",
  "isolationLabel",
  "contractSummary",
  "permissionSummary",
  "ledgerSummary",
  "evidence",
  "evidenceLabel",
  "budgetSummary",
  "observerSummary",
  "rollback",
  "rollbackLabel",
  "permissionGate",
] as const;

const PERMISSION_GATE_KEYS = [
  "approvalRequestId",
  "kind",
  "actionLabel",
  "canonicalResource",
  "policyLabels",
  "reasonLabels",
  "requiredPermission",
  "actualPermission",
  "irreversible",
  "choices",
] as const;

function invalid(reason: FailureReason["reason"] = "malformed"): never {
  throw new InvalidHostEvent(reason);
}

function isCandidateRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined
    || !descriptor.enumerable
    || !("value" in descriptor)
  ) {
    invalid();
  }

  return descriptor.value;
}

function exactRecord<const Keys extends readonly string[]>(
  value: unknown,
  allowedKeys: Keys,
): Readonly<Record<Keys[number], unknown>> {
  if (!isCandidateRecord(value)) {
    invalid();
  }

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== allowedKeys.length
    || ownKeys.some(
      (key) => typeof key !== "string" || !allowedKeys.includes(key),
    )
  ) {
    invalid();
  }

  const record = Object.create(null) as Record<Keys[number], unknown>;
  for (const key of allowedKeys) {
    record[key as Keys[number]] = ownDataValue(value, key);
  }
  return record;
}

function requiredString(value: unknown, maxChars: number): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid();
  }
  if (value.length > maxChars) {
    invalid("oversized");
  }
  return value;
}

function bodyString(value: unknown): string {
  if (typeof value !== "string") {
    invalid();
  }
  if (value.length > MAX_MESSAGE_CHARS) {
    invalid("oversized");
  }
  return value;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") {
    invalid();
  }
  return value;
}

function enumValue<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    invalid();
  }
  return value as Value;
}

function arrayValues(
  value: unknown,
  maxItems: number,
  oversizeIsMalformed = false,
): readonly unknown[] {
  if (!Array.isArray(value)) {
    invalid();
  }
  if (value.length > maxItems) {
    invalid(oversizeIsMalformed ? "malformed" : "oversized");
  }

  const ownKeys = Reflect.ownKeys(value);
  const expectedKeys = value.length + 1;
  if (
    ownKeys.length !== expectedKeys
    || !ownKeys.includes("length")
  ) {
    invalid();
  }

  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    if (!ownKeys.includes(key)) {
      invalid();
    }
    result.push(ownDataValue(value, key));
  }

  return result;
}

function stringArray(
  value: unknown,
  maxItems: number,
): readonly string[] {
  const values = arrayValues(value, maxItems);
  return Object.freeze(
    values.map((item) => requiredString(item, MAX_SUMMARY_ITEM_CHARS)),
  );
}

function permissionGate(value: unknown): TrustedPermissionGate | null {
  if (value === null) {
    return null;
  }

  const record = exactRecord(value, PERMISSION_GATE_KEYS);
  const choices = arrayValues(record.choices, 3, true).map((choice) =>
    enumValue(choice, ["approve", "deny", "cancel"] as const),
  );
  if (new Set(choices).size !== choices.length) {
    invalid();
  }

  const result: TrustedPermissionGate = {
    approvalRequestId: requiredString(
      record.approvalRequestId,
      MAX_STATUS_LABEL_CHARS,
    ),
    kind: enumValue(
      record.kind,
      ["permission", "cloud_consent", "privacy_review"] as const,
    ),
    actionLabel: requiredString(record.actionLabel, MAX_STATUS_LABEL_CHARS),
    canonicalResource: requiredString(
      record.canonicalResource,
      MAX_SUMMARY_ITEM_CHARS,
    ),
    policyLabels: stringArray(record.policyLabels, MAX_POLICY_LABELS),
    reasonLabels: stringArray(record.reasonLabels, MAX_POLICY_LABELS),
    requiredPermission: requiredString(
      record.requiredPermission,
      MAX_STATUS_LABEL_CHARS,
    ),
    actualPermission: requiredString(
      record.actualPermission,
      MAX_STATUS_LABEL_CHARS,
    ),
    irreversible: booleanValue(record.irreversible),
    choices: Object.freeze(choices),
  };

  return Object.freeze(result);
}

function snapshotValue(value: unknown): SanitizedHostSnapshot {
  if (!isCandidateRecord(value)) {
    invalid();
  }
  if (ownDataValue(value, "schemaVersion") !== 1) {
    invalid("unsupported_schema");
  }

  const record = exactRecord(value, SNAPSHOT_KEYS);
  const result: SanitizedHostSnapshot = {
    schemaVersion: 1,
    runId: requiredString(record.runId, MAX_STATUS_LABEL_CHARS),
    phase: enumValue<HostRunPhase>(record.phase, HOST_RUN_PHASES),
    trustTone: enumValue<TrustTone>(
      record.trustTone,
      [
        "trusted_local",
        "explicit_cloud",
        "approval_required",
        "deterministic_deny",
        "fail_closed",
      ],
    ),
    statusLabel: requiredString(record.statusLabel, MAX_STATUS_LABEL_CHARS),
    providerLabel: requiredString(
      record.providerLabel,
      MAX_STATUS_LABEL_CHARS,
    ),
    modelLabel: requiredString(record.modelLabel, MAX_STATUS_LABEL_CHARS),
    privacyClass: enumValue<PrivacyClass>(
      record.privacyClass,
      ["public", "internal", "private", "restricted"],
    ),
    cloudConsentRequired: booleanValue(record.cloudConsentRequired),
    cloudConsentGranted: booleanValue(record.cloudConsentGranted),
    isolation: enumValue<IsolationLevel>(
      record.isolation,
      ["strong", "degraded", "unavailable"],
    ),
    isolationLabel: requiredString(
      record.isolationLabel,
      MAX_STATUS_LABEL_CHARS,
    ),
    contractSummary: stringArray(
      record.contractSummary,
      MAX_SUMMARY_ITEMS,
    ),
    permissionSummary: stringArray(
      record.permissionSummary,
      MAX_SUMMARY_ITEMS,
    ),
    ledgerSummary: stringArray(record.ledgerSummary, MAX_SUMMARY_ITEMS),
    evidence: enumValue<EvidenceState>(
      record.evidence,
      [
        "not_requested",
        "pending",
        "verified",
        "verified_with_warnings",
        "failed",
        "blocked",
      ],
    ),
    evidenceLabel: requiredString(
      record.evidenceLabel,
      MAX_STATUS_LABEL_CHARS,
    ),
    budgetSummary: stringArray(record.budgetSummary, MAX_SUMMARY_ITEMS),
    observerSummary: stringArray(record.observerSummary, MAX_SUMMARY_ITEMS),
    rollback: enumValue<RollbackState>(
      record.rollback,
      ["not_required", "checkpointed", "restoring", "verified", "failed"],
    ),
    rollbackLabel: requiredString(
      record.rollbackLabel,
      MAX_STATUS_LABEL_CHARS,
    ),
    permissionGate: permissionGate(record.permissionGate),
  };

  return Object.freeze(result);
}

function messageValue(value: unknown): UntrustedMessage {
  const record = exactRecord(value, ["id", "author", "text", "createdAt"]);
  const message: UntrustedMessage = {
    id: requiredString(record.id, MAX_STATUS_LABEL_CHARS),
    author: enumValue<MessageAuthor>(record.author, ["user", "nova"]),
    text: bodyString(record.text),
    createdAt: requiredString(record.createdAt, MAX_STATUS_LABEL_CHARS),
  };
  return Object.freeze(message);
}

function eventValue(value: unknown): HostPresentationEvent {
  if (!isCandidateRecord(value)) {
    invalid();
  }

  const type = ownDataValue(value, "type");
  if (typeof type !== "string") {
    invalid();
  }

  switch (type) {
    case "snapshot": {
      const record = exactRecord(value, ["type", "snapshot"]);
      return Object.freeze({
        type,
        snapshot: snapshotValue(record.snapshot),
      });
    }
    case "message": {
      const record = exactRecord(value, ["type", "message"]);
      return Object.freeze({
        type,
        message: messageValue(record.message),
      });
    }
    case "message_replaced": {
      const record = exactRecord(value, ["type", "messageId", "text"]);
      return Object.freeze({
        type,
        messageId: requiredString(
          record.messageId,
          MAX_STATUS_LABEL_CHARS,
        ),
        text: bodyString(record.text),
      });
    }
    case "session_error": {
      const record = exactRecord(value, ["type", "code", "label"]);
      return Object.freeze({
        type,
        code: enumValue(
          record.code,
          [
            "timeout",
            "disconnected",
            "invalid_event",
            "host_unavailable",
          ] as const,
        ),
        label: requiredString(record.label, MAX_STATUS_LABEL_CHARS),
      });
    }
    case "session_closed": {
      const record = exactRecord(value, ["type", "reason"]);
      return Object.freeze({
        type,
        reason: enumValue(
          record.reason,
          ["completed", "cancelled", "failed"] as const,
        ),
      });
    }
    default:
      invalid("unknown_type");
  }
}

export function validateHostEvent(value: unknown): HostEventValidation {
  try {
    return Object.freeze({ ok: true, event: eventValue(value) });
  } catch (error: unknown) {
    const reason = error instanceof InvalidHostEvent
      ? error.reason
      : "malformed";
    return Object.freeze({ ok: false, reason });
  }
}
