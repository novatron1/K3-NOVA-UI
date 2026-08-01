import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import type {
  TrustedPermissionGate,
} from "../domain/presentation-types";

type PermissionDecision = "approve" | "deny" | "cancel";

export interface PermissionGateProps {
  readonly gate: TrustedPermissionGate;
  readonly onDecision: (
    approvalRequestId: string,
    decision: "approve" | "deny" | "cancel",
  ) => Promise<void>;
}

const DECISION_LABELS: Readonly<Record<PermissionDecision, string>> =
  Object.freeze({
    approve: "Approve",
    deny: "Deny",
    cancel: "Cancel",
  });

const SEALED_LAYER_STYLE: CSSProperties = Object.freeze({
  position: "fixed",
  zIndex: 2147483647,
  inset: 0,
  isolation: "isolate",
  pointerEvents: "auto",
});

export function PermissionGate({
  gate,
  onDecision,
}: PermissionGateProps) {
  const titleId = useId();
  const descriptionId = useId();
  const warningId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const decisionLocked = useRef(false);
  const [decisionPending, setDecisionPending] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusInside = (): void => {
      const firstChoice = dialog.querySelector<HTMLButtonElement>(
        "button:not(:disabled)",
      );
      (firstChoice ?? dialog).focus();
    };
    const containFocus = (event: FocusEvent): void => {
      if (
        event.target instanceof Node
        && !dialog.contains(event.target)
      ) {
        focusInside();
      }
    };

    focusInside();
    document.addEventListener("focusin", containFocus, true);

    return () => {
      document.removeEventListener("focusin", containFocus, true);
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  const decide = (decision: PermissionDecision): void => {
    if (decisionLocked.current || !gate.choices.includes(decision)) {
      return;
    }

    decisionLocked.current = true;
    setDecisionPending(true);
    try {
      void Promise.resolve(
        onDecision(gate.approvalRequestId, decision),
      ).catch(() => undefined);
    } catch {
      // The trusted surface stays sealed after an adapter failure.
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key === "Escape"
      && gate.choices.includes("cancel")
    ) {
      event.preventDefault();
      event.stopPropagation();
      decide("cancel");
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }

    const choices = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    const firstChoice = choices[0];
    const lastChoice = choices.at(-1);
    if (firstChoice === undefined || lastChoice === undefined) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    if (event.shiftKey && document.activeElement === firstChoice) {
      event.preventDefault();
      lastChoice.focus();
    } else if (!event.shiftKey && document.activeElement === lastChoice) {
      event.preventDefault();
      firstChoice.focus();
    }
  };

  return (
    <div
      className="permission-gate-layer"
      style={SEALED_LAYER_STYLE}
    >
      <div
        ref={dialogRef}
        className="permission-gate nova-critical-surface"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={gate.irreversible
          ? `${descriptionId} ${warningId}`
          : descriptionId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <p className="permission-gate-eyebrow">Trusted host decision</p>
        <h2 id={titleId}>Permission decision required</h2>
        <p id={descriptionId}>
          {gate.actionLabel} requires an explicit decision for the canonical
          resource below.
        </p>

        <dl className="permission-gate-details">
          <div>
            <dt>Canonical resource</dt>
            <dd><code>{gate.canonicalResource}</code></dd>
          </div>
          <div>
            <dt>Required permission</dt>
            <dd>{gate.requiredPermission}</dd>
          </div>
          <div>
            <dt>Current permission</dt>
            <dd>{gate.actualPermission}</dd>
          </div>
          <div>
            <dt>Policies</dt>
            <dd>{gate.policyLabels.join(", ")}</dd>
          </div>
          <div>
            <dt>Reasons</dt>
            <dd>{gate.reasonLabels.join(", ")}</dd>
          </div>
        </dl>

        {gate.irreversible
          ? (
              <p id={warningId} className="permission-gate-warning">
                This action is irreversible.
              </p>
            )
          : null}

        <div className="permission-gate-actions">
          {gate.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              data-permission-decision={choice}
              disabled={decisionPending}
              onClick={() => {
                decide(choice);
              }}
            >
              {DECISION_LABELS[choice]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
