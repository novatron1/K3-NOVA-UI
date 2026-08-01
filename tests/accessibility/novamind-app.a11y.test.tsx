import { useState } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axeCore from "axe-core";
import { afterEach, describe, expect, it } from "vitest";

import { NovaMindApp } from "../../src/app/NovaMindApp";
import type {
  HostRunPhase,
  TrustedPermissionGate,
} from "../../src/domain/presentation-types";
import {
  FakePresentationHost,
  type FakeClock,
} from "../../src/host/fake-presentation-host";
import type { PresentationState } from "../../src/state/presentation-reducer";
import { createInitialPresentationState } from "../../src/state/presentation-reducer";
import {
  type PresentationController,
  usePresentationController,
} from "../../src/state/use-presentation-controller";
import { makeSnapshot } from "../../src/test/fixtures";
import { UnavailableVoiceCapture } from "../../src/voice/voice-capture";

const PHASES: readonly HostRunPhase[] = [
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
];

axeCore.configure({
  rules: axeCore.getRules(["cat.color"]).map(({ ruleId }) => ({
    id: ruleId,
    enabled: false,
  })),
});

const immediateClock: FakeClock = {
  schedule: (_delayMs, callback) => {
    callback();
    return () => {};
  },
};

function makeGate(): TrustedPermissionGate {
  return {
    approvalRequestId: "approval-accessibility-1",
    kind: "permission",
    actionLabel: "Delete sanitized export",
    canonicalResource: "F:\\exports\\sanitized-report.zip",
    policyLabels: ["workspace-boundary", "destructive-action"],
    reasonLabels: ["Explicit approval is required"],
    requiredPermission: "delete",
    actualPermission: "read",
    irreversible: true,
    choices: ["approve", "deny", "cancel"],
  };
}

function trustToneFor(phase: HostRunPhase): PresentationState["snapshot"]["trustTone"] {
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

function makeState(
  phase: HostRunPhase,
  overrides: Partial<PresentationState> = {},
): PresentationState {
  return {
    ...createInitialPresentationState(),
    snapshot: makeSnapshot({
      phase,
      trustTone: trustToneFor(phase),
      statusLabel: phase === "deterministic_deny"
        ? "Action denied by policy"
        : `Host phase: ${phase}`,
      isolation: phase === "unavailable" ? "unavailable" : "strong",
      isolationLabel: phase === "unavailable"
        ? "Isolation unavailable"
        : "Strong local isolation",
      permissionGate: phase === "approval_required" ? makeGate() : null,
    }),
    sessionState: "connected",
    ...overrides,
  };
}

function FakeHostApp({
  onController,
}: {
  readonly onController: (controller: PresentationController) => void;
}) {
  const [host] = useState(() => new FakePresentationHost({
    initialEvents: [
      {
        type: "snapshot",
        snapshot: makeSnapshot({
          phase: "idle",
          statusLabel: "Ready for a message",
        }),
      },
    ],
    onText: (text) => [
      {
        type: "message",
        message: {
          id: "keyboard-message-1",
          author: "user",
          text,
          createdAt: "2026-08-01T12:00:00.000Z",
        },
      },
      {
        type: "snapshot",
        snapshot: makeSnapshot({
          phase: "responding",
          statusLabel: "Message submitted",
        }),
      },
    ],
    onVoiceTranscript: () => [],
    onPermission: () => [],
  }, immediateClock));
  const [voice] = useState(() => new UnavailableVoiceCapture());
  const controller = usePresentationController(host, voice);
  onController(controller);

  return <NovaMindApp state={controller} controller={controller} />;
}

afterEach(cleanup);

describe("NovaMind accessibility", () => {
  it("has no axe violations in every host phase", async () => {
    for (const phase of PHASES) {
      const view = render(<NovaMindApp state={makeState(phase)} />);
      const results = await axeCore.run(view.container);

      expect(results.violations, `axe violations for ${phase}`).toEqual([]);
      view.unmount();
    }
  }, 15_000);

  it("supports keyboard-only message submission and cancellation", async () => {
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const user = userEvent.setup();
    render(
      <FakeHostApp onController={(value) => {
        controller.current = value;
      }} />,
    );

    const message = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => {
      expect(controller.current?.sessionState).toBe("connected");
    });
    message.focus();
    await user.keyboard("Keyboard-only request");
    await user.tab();
    expect(screen.getByRole("button", { name: "Send message" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Keyboard-only request")).toBeVisible();
    await user.tab();
    for (let index = 0; index < 11; index += 1) {
      await user.tab();
    }
    expect(screen.getByRole("button", { name: "Cancel presentation" })).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(controller.current?.sessionState).toBe("closed");
    });
  });

  it("keeps deterministic focus order for every interactive element", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <NovaMindApp
        state={makeState("responding", { draft: "Ready to send" })}
      />,
    );
    const interactiveElements = Array.from(
      container.querySelectorAll<HTMLElement>(
        "button:not(:disabled), textarea:not(:disabled)",
      ),
    );

    expect(interactiveElements).toHaveLength(13);
    expect(container.querySelector("[tabindex]:not([tabindex='-1'])"))
      .not.toBeInTheDocument();
    for (const element of interactiveElements) {
      await user.tab();
      expect(element).toHaveFocus();
    }
  });

  it("uses polite status for normal transitions", () => {
    render(<NovaMindApp state={makeState("processing")} />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveTextContent("Host phase: processing");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses assertive status only for deterministic denial", () => {
    const { rerender } = render(
      <NovaMindApp state={makeState("deterministic_deny")} />,
    );

    const denial = screen.getByRole("alert");
    expect(denial).toHaveAttribute("aria-live", "assertive");
    expect(denial).toHaveTextContent("Action denied by policy");

    for (const phase of PHASES.filter((value) => value !== "deterministic_deny")) {
      rerender(<NovaMindApp state={makeState(phase)} />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  });

  it("uses text for trust and irreversible risk cues", () => {
    const gatedState = makeState("approval_required");
    const visibleApprovalState: PresentationState = {
      ...gatedState,
      snapshot: {
        ...gatedState.snapshot,
        permissionGate: null,
      },
    };
    const { rerender } = render(
      <NovaMindApp state={visibleApprovalState} />,
    );

    expect(screen.getByRole("complementary", {
      name: "Trust halo: Approval required",
    })).toBeInTheDocument();
    expect(screen.getByText("Approval required")).toBeVisible();

    rerender(<NovaMindApp state={gatedState} />);
    expect(screen.getByRole("alertdialog", {
      name: "Permission decision required",
    })).toHaveAccessibleDescription(
      "Delete sanitized export requires an explicit decision for the canonical resource below. This action is irreversible.",
    );
  });

  it("keeps permission focus trapped and restores focus", async () => {
    const user = userEvent.setup();
    const originalState = makeState("responding");
    const gatedState = makeState("approval_required");
    const { rerender } = render(<NovaMindApp state={originalState} />);
    const opener = screen.getByRole("button", {
      name: /^Run contract Run phase: Responding$/,
    });
    opener.focus();

    rerender(<NovaMindApp state={gatedState} />);
    const approve = screen.getByRole("button", { name: "Approve" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    await waitFor(() => {
      expect(approve).toHaveFocus();
    });

    cancel.focus();
    await user.tab();
    expect(approve).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();

    rerender(<NovaMindApp state={originalState} />);
    expect(opener).toHaveFocus();
  });

  it("keeps voice optional", async () => {
    const user = userEvent.setup();
    render(<NovaMindApp state={makeState("idle")} />);

    const voiceControls = screen.getAllByRole("button", {
      name: "Voice capture unavailable",
    });
    expect(voiceControls).toHaveLength(2);
    expect(voiceControls[0]).toBeDisabled();
    expect(voiceControls[1]).toBeDisabled();

    await user.tab();
    expect(screen.getByRole("button", {
      name: /^Run contract Run phase: Idle$/,
    })).toHaveFocus();
  });
});
