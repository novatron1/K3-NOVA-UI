import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { NovaMindApp } from "../../src/app/NovaMindApp";
import type {
  HostRunPhase,
  TrustTone,
} from "../../src/domain/presentation-types";
import type { PresentationState } from "../../src/state/presentation-reducer";
import { createInitialPresentationState } from "../../src/state/presentation-reducer";
import { makeSnapshot } from "../../src/test/fixtures";
import "../../src/theme/global.css";

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

function canonicalState(phase: HostRunPhase): PresentationState {
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
  const phase = CANONICAL_PHASES[phaseIndex] ?? "idle";

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPhaseIndex((current) => (current + 1) % CANONICAL_PHASES.length);
    }, 5_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div
      data-canonical-phase={phase}
      data-canonical-trust-tone={canonicalTrustTone(phase)}
    >
      <NovaMindApp state={canonicalState(phase)} />
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
