import { describe, expect, it } from "vitest";

import {
  HOST_RUN_PHASES,
  createUnavailableSnapshot,
} from "../../src/domain/presentation-types";
import { makeSnapshot } from "../../src/test/fixtures";

describe("presentation domain types", () => {
  it("defines every documented host phase as a closed vocabulary", () => {
    expect(HOST_RUN_PHASES).toEqual([
      "idle", "listening", "input_review", "processing", "responding",
      "approval_required", "deterministic_deny", "paused", "cancelled",
      "unavailable",
    ]);
  });

  it("does not place privileged or raw data in SanitizedHostSnapshot", () => {
    const serialized = JSON.stringify(makeSnapshot());
    for (const forbidden of [
      "reasoning", "secret", "apiKey", "rawLedger", "providerBody",
      "observerContext", "executionRecord",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("creates an immutable unavailable snapshot", () => {
    const snapshot = createUnavailableSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.contractSummary)).toBe(true);
    expect(snapshot.phase).toBe("unavailable");
    expect(snapshot.trustTone).toBe("fail_closed");
  });

  it("deep-freezes every unavailable snapshot collection", () => {
    const snapshot = createUnavailableSnapshot();

    expect(Object.isFrozen(snapshot.permissionSummary)).toBe(true);
    expect(Object.isFrozen(snapshot.ledgerSummary)).toBe(true);
    expect(Object.isFrozen(snapshot.budgetSummary)).toBe(true);
    expect(Object.isFrozen(snapshot.observerSummary)).toBe(true);
  });
});
