import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { NovaMindApp } from "../../src/app/NovaMindApp";
import type {
  HostRunPhase,
  TrustTone,
} from "../../src/domain/presentation-types";
import type { PresentationState } from "../../src/state/presentation-reducer";
import {
  createInitialPresentationState,
  presentationReducer,
} from "../../src/state/presentation-reducer";
import { validateHostEvent } from "../../src/security/validate-host-event";
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

interface AttemptedHostEvidence {
  readonly executionMarker: string;
  readonly validation: string;
  readonly sanitizedOutput: string;
}

interface CanonicalPresentation {
  readonly state: PresentationState;
  readonly attemptedHostEvidence?: AttemptedHostEvidence;
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
      phase: securityFixture.scenario === "hidden-reasoning-attempt"
        ? "unavailable"
        : securityFixture.snapshot.phase,
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

function canonicalPresentation(
  scenario: CanonicalScenario,
): CanonicalPresentation {
  const { securityFixture } = scenario;
  if (securityFixture?.scenario === "hidden-reasoning-attempt") {
    const validation = validateHostEvent(securityFixture.attemptedHostEvent);
    const initialState = createInitialPresentationState();
    const state = validation.ok
      ? presentationReducer(initialState, {
          type: "host_event",
          event: validation.event,
        })
      : presentationReducer(initialState, {
          type: "host_event",
          event: {
            type: "session_error",
            code: "invalid_event",
            label: "Synthetic hidden reasoning attempt rejected",
          },
        });
    return {
      state,
      attemptedHostEvidence: {
        executionMarker: securityFixture.executionMarker,
        validation: validation.ok
          ? `accepted:${validation.event.type}`
          : `rejected:${validation.reason}`,
        sanitizedOutput: validation.ok
          ? JSON.stringify(validation.event)
          : "none",
      },
    };
  }

  if (securityFixture !== undefined) {
    return {
      state: {
        ...createInitialPresentationState(),
        snapshot: securityFixture.snapshot,
        sessionState: securityFixture.sessionState,
        sessionError: securityFixture.sessionError,
      },
    };
  }

  const { phase } = scenario;
  const unavailable = phase === "unavailable";
  const explicitCloud = phase === "processing";
  return {
    state: {
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
    },
  };
}

export function CanonicalStateSequence() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const scenario = CANONICAL_SCENARIOS[phaseIndex] ?? CANONICAL_SCENARIOS[0];
  if (scenario === undefined) {
    throw new Error("Canonical e2e scenario is unavailable.");
  }
  const phase = scenario.phase;
  const presentation = canonicalPresentation(scenario);

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
      data-attempted-host-fixture={
        presentation.attemptedHostEvidence?.executionMarker
      }
      data-attempted-host-validation={
        presentation.attemptedHostEvidence?.validation
      }
      data-sanitized-host-output={
        presentation.attemptedHostEvidence?.sanitizedOutput
      }
    >
      <NovaMindApp state={presentation.state} />
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
