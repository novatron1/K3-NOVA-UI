import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { NovaMindApp } from "../../src/app/NovaMindApp";
import type {
  HostRunPhase,
  TrustTone,
} from "../../src/domain/presentation-types";
import type { PresentationState } from "../../src/state/presentation-reducer";
import { createInitialPresentationState } from "../../src/state/presentation-reducer";
import {
  makeSnapshot,
  SECURITY_BOUNDARY_CANONICAL_FIXTURES,
  type SecurityBoundaryCanonicalFixture,
} from "../../src/test/fixtures";
import "../../src/theme/global.css";

interface CanonicalScenario {
  readonly phase: HostRunPhase;
  readonly securityFixture?: SecurityBoundaryCanonicalFixture;
}

const CANONICAL_PHASES: readonly HostRunPhase[] = Object.freeze([
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
]);

const CANONICAL_SCENARIOS: readonly CanonicalScenario[] = Object.freeze([
  ...SECURITY_BOUNDARY_CANONICAL_FIXTURES.map(
    (securityFixture): CanonicalScenario => Object.freeze({
      phase: securityFixture.snapshot.phase,
      securityFixture,
    }),
  ),
  ...CANONICAL_PHASES.map((phase): CanonicalScenario => Object.freeze({ phase })),
]);

function canonicalTrustTone(phase: HostRunPhase): TrustTone {
  if (phase === "processing") {
    return "explicit_cloud";
  }
  if (phase === "approval_required") {
    return "approval_required";
  }
  if (phase === "deterministic_deny") {
    return "deterministic_deny";
  }
  if (phase === "unavailable") {
    return "fail_closed";
  }
  return "trusted_local";
}

function canonicalState(scenario: CanonicalScenario): PresentationState {
  if (scenario.securityFixture !== undefined) {
    return {
      ...createInitialPresentationState(),
      snapshot: scenario.securityFixture.snapshot,
      sessionState: scenario.securityFixture.sessionState,
      sessionError: scenario.securityFixture.sessionError,
    };
  }

  const { phase } = scenario;
  const unavailable = phase === "unavailable";
  const explicitCloud = phase === "processing";
  return {
    ...createInitialPresentationState(),
    snapshot: makeSnapshot({
      runId: `canonical-browser-${phase}`,
      phase,
      trustTone: canonicalTrustTone(phase),
      statusLabel: `Canonical host phase: ${phase}`,
      providerLabel: explicitCloud ? "Explicit cloud fixture" : "Fixed local fixture",
      modelLabel: "Synthetic accessibility model",
      privacyClass: explicitCloud ? "restricted" : "private",
      cloudConsentRequired: explicitCloud,
      cloudConsentGranted: explicitCloud,
      isolation: unavailable ? "unavailable" : "strong",
      isolationLabel: unavailable
        ? "Canonical isolation unavailable"
        : "Canonical strong isolation",
      permissionGate: null,
    }),
    sessionState: "connected",
  };
}

export function CanonicalStateSequence() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const scenario = CANONICAL_SCENARIOS[phaseIndex] ?? CANONICAL_SCENARIOS[0];
  if (scenario === undefined) {
    throw new Error("Canonical e2e scenario is unavailable.");
  }
  const phase = scenario.phase;

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPhaseIndex((current) => (current + 1) % CANONICAL_SCENARIOS.length);
    }, 5_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div
      data-canonical-phase={phase}
      data-canonical-trust-tone={canonicalTrustTone(phase)}
      data-canonical-scenario={scenario.securityFixture?.scenario ?? phase}
    >
      <NovaMindApp state={canonicalState(scenario)} />
    </div>
  );
}

const rootElement = document.getElementById("canonical-root");
if (rootElement === null) {
  throw new Error("Canonical accessibility root is unavailable.");
}

createRoot(rootElement).render(
  <StrictMode>
    <CanonicalStateSequence />
  </StrictMode>,
);
