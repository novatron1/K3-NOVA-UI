import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NovaMindApp } from "../../src/app/NovaMindApp";
import { LivingOrgans } from "../../src/components/LivingOrgans";
import type {
  LivingOrganId,
  SanitizedHostSnapshot,
} from "../../src/domain/presentation-types";
import type {
  PresentationHostAdapter,
  PresentationHostHandlers,
  PresentationSession,
} from "../../src/host/presentation-host";
import type { PresentationState } from "../../src/state/presentation-reducer";
import {
  createInitialPresentationState,
} from "../../src/state/presentation-reducer";
import {
  type PresentationController,
  usePresentationController,
} from "../../src/state/use-presentation-controller";
import { makeSnapshot } from "../../src/test/fixtures";
import { UnavailableVoiceCapture } from "../../src/voice/voice-capture";

afterEach(cleanup);

const ORGAN_IDS: readonly LivingOrganId[] = [
  "contract",
  "permissions",
  "ledger",
  "evidence",
  "provider",
  "privacy",
  "budgets",
  "isolation",
  "observer",
  "rollback",
];

const ALL_ORGANS = new Set<LivingOrganId>(ORGAN_IDS);

function renderOrgans(
  snapshot: SanitizedHostSnapshot,
  openOrgans: ReadonlySet<LivingOrganId> = ALL_ORGANS,
) {
  return render(
    <LivingOrgans
      snapshot={snapshot}
      openOrgans={openOrgans}
      onToggle={() => {}}
    />,
  );
}

function organ(container: HTMLElement, organId: LivingOrganId): HTMLElement {
  const element = container.querySelector(`[data-organ-id="${organId}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Living organ ${organId} was not rendered.`);
  }
  return element;
}

function session(): PresentationSession {
  return {
    submitText: async () => {},
    submitVoiceTranscript: async () => {},
    decidePermission: async () => {},
    cancel: async () => {},
    close: async () => {},
  };
}

function ControllerOrgansApp({
  host,
  onController,
}: {
  readonly host: PresentationHostAdapter;
  readonly onController: (controller: PresentationController) => void;
}) {
  const [voice] = useState(() => new UnavailableVoiceCapture());
  const controller = usePresentationController(host, voice);
  onController(controller);
  return <NovaMindApp state={controller} controller={controller} />;
}

describe("LivingOrgans", () => {
  it("renders all ten documented living organs", () => {
    const state: PresentationState = {
      ...createInitialPresentationState(),
      snapshot: makeSnapshot(),
      openOrgans: ALL_ORGANS,
      sessionState: "connected",
    };
    const { container } = render(<NovaMindApp state={state} />);
    const presentation = container.querySelector(".nova-presentation");
    const conversation = container.querySelector(".nova-conversation");
    const organs = container.querySelector(".living-organs");

    expect(organs).not.toBeNull();
    expect(presentation?.contains(organs)).toBe(true);
    expect(conversation?.contains(organs)).toBe(false);
    expect(organs?.querySelectorAll("[data-organ-id]")).toHaveLength(10);

    for (const organId of ORGAN_IDS) {
      const card = organ(container, organId);
      const button = card.querySelector("button");
      const panel = card.querySelector("section");

      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(button).toHaveAttribute("aria-controls", panel?.id);
      expect(panel).toHaveAccessibleName();
    }
  });

  it("shows provider privacy and consent during cloud state", () => {
    const { container } = renderOrgans(makeSnapshot({
      trustTone: "explicit_cloud",
      providerLabel: "Kimi Cloud",
      modelLabel: "K2.5",
      privacyClass: "restricted",
      cloudConsentRequired: true,
      cloudConsentGranted: true,
    }), new Set<LivingOrganId>(["provider", "privacy"]));
    const provider = organ(container, "provider");
    const privacy = organ(container, "privacy");

    expect(provider).toHaveTextContent("Provider: Kimi Cloud");
    expect(provider).toHaveTextContent("Model: K2.5");
    expect(privacy).toHaveTextContent("Privacy classification: restricted");
    expect(privacy).toHaveTextContent("Cloud consent required: Yes");
    expect(privacy).toHaveTextContent("Cloud consent granted: Yes");
  });

  it("keeps unavailable strong isolation gray and locked", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <LivingOrgans
        snapshot={makeSnapshot({
          isolation: "unavailable",
          isolationLabel: "Strong isolation unavailable",
        })}
        openOrgans={new Set<LivingOrganId>(["isolation"])}
        onToggle={onToggle}
      />,
    );
    const isolation = organ(container, "isolation");
    const control = within(isolation).getByRole("button", {
      name: /isolation/i,
    });

    expect(isolation).toHaveAttribute("data-organ-state", "unavailable");
    expect(isolation).toHaveAttribute("data-organ-tone", "unavailable");
    expect(isolation).toHaveAttribute("data-locked", "true");
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(within(isolation).getByText("Strong isolation unavailable"))
      .toBeVisible();
    fireEvent.click(control);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("distinguishes pending failed blocked and verified evidence", () => {
    const states = [
      ["pending", "Pending"],
      ["failed", "Failed"],
      ["blocked", "Blocked"],
      ["verified", "Verified"],
    ] as const;
    const { container, rerender } = renderOrgans(makeSnapshot({
      evidence: "pending",
      evidenceLabel: "Evidence collection is queued",
    }), new Set<LivingOrganId>(["evidence"]));

    for (const [state, label] of states) {
      rerender(
        <LivingOrgans
          snapshot={makeSnapshot({
            evidence: state,
            evidenceLabel: `Sanitized ${state} evidence label`,
          })}
          openOrgans={new Set<LivingOrganId>(["evidence"])}
          onToggle={() => {}}
        />,
      );

      const evidence = organ(container, "evidence");
      expect(evidence).toHaveAttribute("data-organ-state", state);
      expect(within(evidence).getByText(`Evidence state: ${label}`))
        .toBeVisible();
    }
  });

  it("shows rollback verified only from host snapshot", () => {
    const { container, rerender } = renderOrgans(makeSnapshot({
      rollback: "checkpointed",
      rollbackLabel: "Deceptive label says verified",
    }), new Set<LivingOrganId>(["rollback"]));
    let rollback = organ(container, "rollback");

    expect(rollback).toHaveAttribute("data-organ-state", "checkpointed");
    expect(within(rollback).getByText("Rollback state: Checkpointed"))
      .toBeVisible();
    expect(within(rollback).queryByText("Rollback state: Verified"))
      .not.toBeInTheDocument();

    rerender(
      <LivingOrgans
        snapshot={makeSnapshot({
          rollback: "verified",
          rollbackLabel: "Trusted rollback verification",
        })}
        openOrgans={new Set<LivingOrganId>(["rollback"])}
        onToggle={() => {}}
      />,
    );
    rollback = organ(container, "rollback");

    expect(rollback).toHaveAttribute("data-organ-state", "verified");
    expect(within(rollback).getByText("Rollback state: Verified"))
      .toBeVisible();
  });

  it("shows observer labels without raw observer context", () => {
    const snapshot = Object.assign(makeSnapshot({
      observerSummary: ["Trajectory drift within sanitized threshold"],
    }), {
      observerContext: {
        hiddenReasoning: "RAW_OBSERVER_CONTEXT_SENTINEL",
      },
    });
    const { container } = renderOrgans(
      snapshot,
      new Set<LivingOrganId>(["observer"]),
    );
    const observer = organ(container, "observer");

    expect(observer).toHaveTextContent(
      "Trajectory drift within sanitized threshold",
    );
    expect(observer).not.toHaveTextContent("RAW_OBSERVER_CONTEXT_SENTINEL");
  });

  it("does not accept messages or provider output as props", () => {
    const validProps = {
      snapshot: makeSnapshot(),
      openOrgans: new Set<LivingOrganId>(),
      onToggle: () => {},
    };

    // @ts-expect-error Untrusted messages are not part of LivingOrgansProps.
    const withMessages = <LivingOrgans {...validProps} messages={[]} />;
    const withProviderOutput = (
      <LivingOrgans
        {...validProps}
        // @ts-expect-error Raw provider output is not part of LivingOrgansProps.
        providerOutput={{ secret: "RAW_PROVIDER_OUTPUT_SENTINEL" }}
      />
    );

    const { container, rerender } = render(withMessages);
    expect(container).not.toHaveTextContent("RAW_PROVIDER_OUTPUT_SENTINEL");
    rerender(withProviderOutput);
    expect(container).not.toHaveTextContent("RAW_PROVIDER_OUTPUT_SENTINEL");
  });

  it("does not expose raw ledger events", () => {
    const snapshot = Object.assign(makeSnapshot({
      ledgerSummary: ["Sanitized ledger checkpoint"],
    }), {
      rawLedger: [{
        payload: "RAW_LEDGER_EVENT_SENTINEL",
        secret: "ledger-private",
      }],
    });
    const { container } = renderOrgans(
      snapshot,
      new Set<LivingOrganId>(["ledger"]),
    );
    const ledger = organ(container, "ledger");

    expect(ledger).toHaveTextContent("Sanitized ledger checkpoint");
    expect(ledger).not.toHaveTextContent("RAW_LEDGER_EVENT_SENTINEL");
    expect(ledger).not.toHaveTextContent("ledger-private");
  });

  it("organ motion occurs only when its trusted summary changes", () => {
    function Harness({
      draft,
      messageRevision,
      openOrgans,
      snapshot,
    }: {
      readonly draft: string;
      readonly messageRevision: number;
      readonly openOrgans: ReadonlySet<LivingOrganId>;
      readonly snapshot: SanitizedHostSnapshot;
    }) {
      return (
        <div data-draft={draft} data-message-revision={messageRevision}>
          <LivingOrgans
            snapshot={snapshot}
            openOrgans={openOrgans}
            onToggle={() => {}}
          />
        </div>
      );
    }

    const initialSnapshot = makeSnapshot({
      contractSummary: ["Contract revision 1"],
      providerLabel: "Local provider",
    });
    const { container, rerender } = render(
      <Harness
        draft=""
        messageRevision={0}
        openOrgans={new Set()}
        snapshot={initialSnapshot}
      />,
    );
    const initialContractPulse = organ(container, "contract")
      .querySelector("[data-organ-pulse]");
    const initialProviderPulse = organ(container, "provider")
      .querySelector("[data-organ-pulse]");

    expect(initialContractPulse).toHaveAttribute("data-motion-revision", "0");
    expect(initialProviderPulse).toHaveAttribute("data-motion-revision", "0");

    rerender(
      <Harness
        draft="Unsubmitted draft changed"
        messageRevision={1}
        openOrgans={new Set<LivingOrganId>(["contract"])}
        snapshot={initialSnapshot}
      />,
    );

    expect(organ(container, "contract").querySelector("[data-organ-pulse]"))
      .toBe(initialContractPulse);
    expect(organ(container, "provider").querySelector("[data-organ-pulse]"))
      .toBe(initialProviderPulse);

    rerender(
      <Harness
        draft="Unsubmitted draft changed"
        messageRevision={1}
        openOrgans={new Set<LivingOrganId>(["contract"])}
        snapshot={makeSnapshot({
          contractSummary: ["Contract revision 2"],
          providerLabel: "Local provider",
        })}
      />,
    );
    const changedContractPulse = organ(container, "contract")
      .querySelector("[data-organ-pulse]");

    expect(changedContractPulse).not.toBe(initialContractPulse);
    expect(changedContractPulse).toHaveAttribute("data-motion-revision", "1");
    expect(organ(container, "provider").querySelector("[data-organ-pulse]"))
      .toBe(initialProviderPulse);
  });

  it("sends the exact organ identity when toggled", () => {
    const onToggle = vi.fn();
    render(
      <LivingOrgans
        snapshot={makeSnapshot()}
        openOrgans={new Set()}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /ledger timeline/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("ledger");
  });

  it("toggles panels through the controller without changing trusted state or unrelated motion", async () => {
    const connection: { handlers: PresentationHostHandlers | null } = {
      handlers: null,
    };
    const host: PresentationHostAdapter = {
      connect: async (handlers) => {
        connection.handlers = handlers;
        return session();
      },
    };
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const { container } = render(
      <ControllerOrgansApp
        host={host}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );

    await waitFor(() => {
      expect(connection.handlers).not.toBeNull();
    });
    act(() => {
      connection.handlers?.onEvent({
        type: "snapshot",
        snapshot: makeSnapshot({
          phase: "processing",
          trustTone: "trusted_local",
          contractSummary: ["Reducer-backed contract summary"],
          providerLabel: "Stable local provider",
        }),
      });
    });
    await waitFor(() => {
      expect(controller.current?.snapshot.statusLabel)
        .toBe("Processing locally");
    });

    const contractControl = within(organ(container, "contract")).getByRole(
      "button",
      { name: /run contract/i },
    );
    const trustedSnapshot = controller.current?.snapshot;
    const contractPulse = organ(container, "contract")
      .querySelector("[data-organ-pulse]");
    const providerPulse = organ(container, "provider")
      .querySelector("[data-organ-pulse]");
    expect(contractControl).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(contractControl);

    await waitFor(() => {
      expect(contractControl).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("region", { name: /run contract/i }))
        .toHaveTextContent("Reducer-backed contract summary");
      expect(controller.current?.openOrgans.has("contract")).toBe(true);
    });
    expect(controller.current?.snapshot).toBe(trustedSnapshot);
    expect(controller.current?.snapshot.phase).toBe("processing");
    expect(controller.current?.snapshot.trustTone).toBe("trusted_local");
    expect(organ(container, "contract").querySelector("[data-organ-pulse]"))
      .toBe(contractPulse);
    expect(organ(container, "provider").querySelector("[data-organ-pulse]"))
      .toBe(providerPulse);
  });
});
