import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_CHARS,
  MAX_STATUS_LABEL_CHARS,
  validateHostEvent,
} from "../../src/security/validate-host-event";
import { makeSnapshot } from "../../src/test/fixtures";

describe("validateHostEvent", () => {
  it("rejects unknown host event types", () => {
    expect(validateHostEvent({ type: "policy_decision", decision: "allow" }))
      .toEqual({ ok: false, reason: "unknown_type" });
  });

  it("rejects unsupported schema versions", () => {
    const snapshot = { ...makeSnapshot(), schemaVersion: 2 };
    expect(validateHostEvent({ type: "snapshot", snapshot }))
      .toEqual({ ok: false, reason: "unsupported_schema" });
  });

  it("rejects oversized labels and message bodies", () => {
    expect(validateHostEvent({
      type: "message",
      message: {
        id: "m1",
        author: "nova",
        text: "x".repeat(MAX_MESSAGE_CHARS + 1),
        createdAt: "2026-07-29T00:00:00.000Z",
      },
    })).toEqual({ ok: false, reason: "oversized" });
  });

  it("rejects unsupported permission choices", () => {
    const snapshot = {
      ...makeSnapshot(),
      permissionGate: {
        approvalRequestId: "approval-1",
        kind: "permission",
        actionLabel: "Read file",
        canonicalResource: "F:\\project\\file.txt",
        policyLabels: ["path-policy"],
        reasonLabels: ["approval-required"],
        requiredPermission: "write",
        actualPermission: "read",
        irreversible: false,
        choices: ["approve", "elevate"],
      },
    };
    expect(validateHostEvent({ type: "snapshot", snapshot }))
      .toEqual({ ok: false, reason: "malformed" });
  });

  it("accepts and freezes each closed host event variant", () => {
    const values: readonly unknown[] = [
      { type: "snapshot", snapshot: makeSnapshot() },
      {
        type: "message",
        message: {
          id: "m1",
          author: "user",
          text: "hello",
          createdAt: "2026-07-29T00:00:00.000Z",
        },
      },
      { type: "message_replaced", messageId: "m1", text: "safe replacement" },
      { type: "session_error", code: "timeout", label: "Host timed out" },
      { type: "session_closed", reason: "completed" },
    ];

    for (const value of values) {
      const result = validateHostEvent(value);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.event)).toBe(true);
      }
    }
  });

  it("reconstructs a fresh deeply frozen snapshot event", () => {
    const snapshot = makeSnapshot({
      permissionGate: {
        approvalRequestId: "approval-1",
        kind: "permission",
        actionLabel: "Read file",
        canonicalResource: "F:\\project\\file.txt",
        policyLabels: ["path-policy"],
        reasonLabels: ["approval-required"],
        requiredPermission: "read",
        actualPermission: "none",
        irreversible: false,
        choices: ["approve", "deny", "cancel"],
      },
    });
    const input = { type: "snapshot", snapshot };

    const result = validateHostEvent(input);

    expect(result.ok).toBe(true);
    if (result.ok && result.event.type === "snapshot") {
      expect(result.event).not.toBe(input);
      expect(result.event.snapshot).not.toBe(snapshot);
      expect(result.event.snapshot.contractSummary)
        .not.toBe(snapshot.contractSummary);
      expect(result.event.snapshot.permissionGate)
        .not.toBe(snapshot.permissionGate);
      expect(Object.isFrozen(result.event.snapshot)).toBe(true);
      expect(Object.isFrozen(result.event.snapshot.contractSummary)).toBe(true);
      expect(Object.isFrozen(result.event.snapshot.permissionGate)).toBe(true);
      expect(Object.isFrozen(
        result.event.snapshot.permissionGate?.policyLabels,
      )).toBe(true);
    }
  });

  it("rejects extra keys at every validated boundary", () => {
    expect(validateHostEvent({
      type: "message",
      message: {
        id: "m1",
        author: "nova",
        text: "hello",
        createdAt: "2026-07-29T00:00:00.000Z",
        providerBody: "private",
      },
    })).toEqual({ ok: false, reason: "malformed" });

    expect(validateHostEvent({
      type: "session_closed",
      reason: "completed",
      decision: "allow",
    })).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects labels beyond the fixed validation ceiling", () => {
    expect(validateHostEvent({
      type: "session_error",
      code: "disconnected",
      label: "x".repeat(MAX_STATUS_LABEL_CHARS + 1),
    })).toEqual({ ok: false, reason: "oversized" });
  });

  it("rejects malformed values without throwing", () => {
    for (const value of [
      null,
      [],
      { type: 7 },
      { type: "message", message: null },
      {
        type: "session_error",
        code: "permission_decision",
        label: "No",
      },
    ]) {
      expect(() => validateHostEvent(value)).not.toThrow();
      expect(validateHostEvent(value))
        .toEqual({ ok: false, reason: "malformed" });
    }
  });
});
