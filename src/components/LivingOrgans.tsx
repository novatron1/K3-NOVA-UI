import { Component, type ReactNode } from "react";

import type {
  EvidenceState,
  HostRunPhase,
  IsolationLevel,
  LivingOrganId,
  RollbackState,
  SanitizedHostSnapshot,
} from "../domain/presentation-types";

export interface LivingOrgansProps {
  readonly snapshot: SanitizedHostSnapshot;
  readonly openOrgans: ReadonlySet<LivingOrganId>;
  readonly onToggle: (organId: LivingOrganId) => void;
}

interface OrganDetail {
  readonly label: string;
  readonly value: string;
}

interface OrganView {
  readonly state: string;
  readonly tone: "available" | "consent-warning" | "unavailable";
  readonly label: string;
  readonly details: readonly OrganDetail[];
  readonly summaryItems: readonly string[];
  readonly motionTokens: readonly string[];
  readonly locked?: boolean;
}

interface OrganDescriptor {
  readonly id: LivingOrganId;
  readonly title: string;
  readonly select: (snapshot: SanitizedHostSnapshot) => OrganView;
}

const EVIDENCE_LABELS: Readonly<Record<EvidenceState, string>> = Object.freeze({
  not_requested: "Not requested",
  pending: "Pending",
  verified: "Verified",
  verified_with_warnings: "Verified with warnings",
  failed: "Failed",
  blocked: "Blocked",
});

const PHASE_LABELS: Readonly<Record<HostRunPhase, string>> = Object.freeze({
  idle: "Idle",
  listening: "Listening",
  input_review: "Input review",
  processing: "Processing",
  responding: "Responding",
  approval_required: "Approval required",
  deterministic_deny: "Deterministic deny",
  paused: "Paused",
  cancelled: "Cancelled",
  unavailable: "Unavailable",
});

const ISOLATION_LABELS: Readonly<Record<IsolationLevel, string>> = Object.freeze({
  strong: "Strong",
  degraded: "Degraded",
  unavailable: "Unavailable",
});

const ROLLBACK_LABELS: Readonly<Record<RollbackState, string>> = Object.freeze({
  not_required: "Not required",
  checkpointed: "Checkpointed",
  restoring: "Restoring",
  verified: "Verified",
  failed: "Failed",
});

function firstSummary(
  summary: readonly string[],
  unavailableLabel: string,
): string {
  return summary[0] ?? unavailableLabel;
}

function cloudConsentState(
  required: boolean,
  granted: boolean,
): {
  readonly label: string;
  readonly state: string;
  readonly tone: "available" | "consent-warning";
} {
  if (!required) {
    return {
      label: "Not required",
      state: "consent_not_required",
      tone: "available",
    };
  }

  if (!granted) {
    return {
      label: "Required, not granted",
      state: "consent_required_not_granted",
      tone: "consent-warning",
    };
  }

  return {
    label: "Required, granted",
    state: "consent_granted",
    tone: "available",
  };
}

const ORGAN_DESCRIPTORS: readonly OrganDescriptor[] = Object.freeze([
  {
    id: "contract",
    title: "Run contract",
    select: (snapshot) => ({
      state: snapshot.phase,
      tone: snapshot.phase === "unavailable" ? "unavailable" : "available",
      label: `Run phase: ${PHASE_LABELS[snapshot.phase]}`,
      details: [
        { label: "Run ID", value: snapshot.runId },
        {
          label: "Host note (non-authoritative)",
          value: snapshot.statusLabel,
        },
      ],
      summaryItems: snapshot.contractSummary,
      motionTokens: [
        snapshot.runId,
        snapshot.phase,
        ...snapshot.contractSummary,
      ],
    }),
  },
  {
    id: "permissions",
    title: "Permissions",
    select: (snapshot) => ({
      state: "reported",
      tone: snapshot.phase === "unavailable" ? "unavailable" : "available",
      label: firstSummary(
        snapshot.permissionSummary,
        "No sanitized permission summary",
      ),
      details: [],
      summaryItems: snapshot.permissionSummary,
      motionTokens: [...snapshot.permissionSummary],
    }),
  },
  {
    id: "ledger",
    title: "Ledger timeline",
    select: (snapshot) => ({
      state: "sanitized",
      tone: snapshot.phase === "unavailable" ? "unavailable" : "available",
      label: firstSummary(
        snapshot.ledgerSummary,
        "No sanitized ledger summary",
      ),
      details: [],
      summaryItems: snapshot.ledgerSummary,
      motionTokens: [...snapshot.ledgerSummary],
    }),
  },
  {
    id: "evidence",
    title: "Evidence",
    select: (snapshot) => ({
      state: snapshot.evidence,
      tone: snapshot.phase === "unavailable" ? "unavailable" : "available",
      label: `Evidence state: ${EVIDENCE_LABELS[snapshot.evidence]}`,
      details: [
        {
          label: "Host note (non-authoritative)",
          value: snapshot.evidenceLabel,
        },
      ],
      summaryItems: [],
      motionTokens: [snapshot.evidence],
    }),
  },
  {
    id: "provider",
    title: "Provider and model",
    select: (snapshot) => ({
      state: "reported",
      tone: snapshot.phase === "unavailable" ? "unavailable" : "available",
      label: `${snapshot.providerLabel} · ${snapshot.modelLabel}`,
      details: [
        { label: "Provider", value: snapshot.providerLabel },
        { label: "Model", value: snapshot.modelLabel },
      ],
      summaryItems: [],
      motionTokens: [snapshot.providerLabel, snapshot.modelLabel],
    }),
  },
  {
    id: "privacy",
    title: "Privacy and consent",
    select: (snapshot) => {
      const consent = cloudConsentState(
        snapshot.cloudConsentRequired,
        snapshot.cloudConsentGranted,
      );

      return {
        state: consent.state,
        tone: consent.tone === "consent-warning"
          ? "consent-warning"
          : snapshot.phase === "unavailable"
            ? "unavailable"
            : "available",
        label: `Privacy: ${snapshot.privacyClass} | Cloud consent: ${consent.label}`,
        details: [
          { label: "Privacy classification", value: snapshot.privacyClass },
          {
            label: "Cloud consent required",
            value: snapshot.cloudConsentRequired ? "Yes" : "No",
          },
          {
            label: "Cloud consent granted",
            value: snapshot.cloudConsentGranted ? "Yes" : "No",
          },
        ],
        summaryItems: [],
        motionTokens: [
          snapshot.privacyClass,
          snapshot.cloudConsentRequired ? "required" : "not-required",
          snapshot.cloudConsentGranted ? "granted" : "not-granted",
        ],
      };
    },
  },
  {
    id: "budgets",
    title: "Budgets",
    select: (snapshot) => ({
      state: "reported",
      tone: snapshot.phase === "unavailable" ? "unavailable" : "available",
      label: firstSummary(snapshot.budgetSummary, "No sanitized budget summary"),
      details: [],
      summaryItems: snapshot.budgetSummary,
      motionTokens: [...snapshot.budgetSummary],
    }),
  },
  {
    id: "isolation",
    title: "Isolation",
    select: (snapshot) => ({
      state: snapshot.isolation,
      tone: snapshot.isolation === "unavailable"
        ? "unavailable"
        : "available",
      label: `Isolation state: ${ISOLATION_LABELS[snapshot.isolation]}`,
      details: [
        {
          label: "Host note (non-authoritative)",
          value: snapshot.isolationLabel,
        },
      ],
      summaryItems: [],
      motionTokens: [snapshot.isolation],
      locked: snapshot.isolation === "unavailable",
    }),
  },
  {
    id: "observer",
    title: "Observer",
    select: (snapshot) => ({
      state: "sanitized",
      tone: snapshot.phase === "unavailable" ? "unavailable" : "available",
      label: firstSummary(
        snapshot.observerSummary,
        "No sanitized observer summary",
      ),
      details: [],
      summaryItems: snapshot.observerSummary,
      motionTokens: [...snapshot.observerSummary],
    }),
  },
  {
    id: "rollback",
    title: "Rollback",
    select: (snapshot) => ({
      state: snapshot.rollback,
      tone: snapshot.phase === "unavailable" ? "unavailable" : "available",
      label: `Rollback state: ${ROLLBACK_LABELS[snapshot.rollback]}`,
      details: [
        {
          label: "Host note (non-authoritative)",
          value: snapshot.rollbackLabel,
        },
      ],
      summaryItems: [],
      motionTokens: [snapshot.rollback],
    }),
  },
] satisfies readonly OrganDescriptor[]);

interface OrganCardProps {
  readonly descriptor: OrganDescriptor;
  readonly snapshot: SanitizedHostSnapshot;
  readonly open: boolean;
  readonly onToggle: (organId: LivingOrganId) => void;
}

interface OrganCardState {
  readonly motionRevision: number;
  readonly motionTokens: readonly string[];
}

function equalTokens(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((token, index) => token === right[index]);
}

class OrganCard extends Component<OrganCardProps, OrganCardState> {
  constructor(props: OrganCardProps) {
    super(props);
    this.state = {
      motionRevision: 0,
      motionTokens: props.descriptor.select(props.snapshot).motionTokens,
    };
  }

  static getDerivedStateFromProps(
    props: OrganCardProps,
    state: OrganCardState,
  ): OrganCardState | null {
    const motionTokens = props.descriptor.select(props.snapshot).motionTokens;
    if (equalTokens(state.motionTokens, motionTokens)) {
      return null;
    }

    return {
      motionRevision: state.motionRevision + 1,
      motionTokens,
    };
  }

  override render(): ReactNode {
    const { descriptor, onToggle, open, snapshot } = this.props;
    const { motionRevision } = this.state;
    const view = descriptor.select(snapshot);
    const locked = view.locked === true;
    const expanded = !locked && open;
    const controlId = `living-organ-${descriptor.id}-control`;
    const panelId = `living-organ-${descriptor.id}-panel`;

    return (
      <article
        className="living-organ"
        data-organ-id={descriptor.id}
        data-organ-state={view.state}
        data-organ-tone={view.tone}
        data-locked={locked ? "true" : undefined}
      >
        <button
          id={controlId}
          type="button"
          aria-label={`${descriptor.title} ${view.label}`}
          aria-controls={panelId}
          aria-expanded={expanded}
          aria-disabled={locked ? "true" : undefined}
          disabled={locked}
          onClick={() => onToggle(descriptor.id)}
        >
          <span className="living-organ-title">{descriptor.title}</span>
          <span className="living-organ-summary">{view.label}</span>
          <span
            key={`${descriptor.id}:${motionRevision}`}
            className={motionRevision === 0
              ? "living-organ-signal"
              : "living-organ-signal living-organ-signal--pulse"}
            data-organ-pulse=""
            data-motion-revision={motionRevision}
            aria-hidden="true"
          />
        </button>

        <section id={panelId} aria-labelledby={controlId} hidden={!expanded}>
          {view.details.map((detail) => (
            <p key={detail.label}>
              {`${detail.label}: ${detail.value}`}
            </p>
          ))}
          {view.summaryItems.length === 0
            ? null
            : (
                <ul>
                  {view.summaryItems.map((item, index) => (
                    <li key={`${index}:${item}`}>{item}</li>
                  ))}
                </ul>
              )}
        </section>
      </article>
    );
  }
}

export function LivingOrgans({
  snapshot,
  openOrgans,
  onToggle,
}: LivingOrgansProps) {
  return (
    <aside className="living-organs" aria-label="Technical status organs">
      {ORGAN_DESCRIPTORS.map((descriptor) => (
        <OrganCard
          key={descriptor.id}
          descriptor={descriptor}
          snapshot={snapshot}
          open={openOrgans.has(descriptor.id)}
          onToggle={onToggle}
        />
      ))}
    </aside>
  );
}
