import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NovaMindApp } from "../../src/app/NovaMindApp";
import appStyles from "../../src/app/NovaMindApp.module.css";
import { PermissionGate } from "../../src/components/PermissionGate";
import type {
  TrustedPermissionGate,
  UntrustedMessage,
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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
    },
    reject: (reason) => {
      rejectPromise?.(reason);
    },
  };
}

function makeGate(
  overrides: Partial<TrustedPermissionGate> = {},
): TrustedPermissionGate {
  return {
    approvalRequestId: "approval-stable-1",
    kind: "permission",
    actionLabel: "Delete workspace export",
    canonicalResource: "F:\\exports\\canonical-report.zip",
    policyLabels: ["workspace-boundary", "destructive-action"],
    reasonLabels: ["Explicit approval is required"],
    requiredPermission: "delete",
    actualPermission: "read",
    irreversible: true,
    choices: ["deny", "cancel"],
    ...overrides,
  };
}

function makeMessage(text: string): UntrustedMessage {
  return {
    id: "untrusted-permission-message",
    author: "nova",
    text,
    createdAt: "2026-07-31T12:00:00.000Z",
  };
}

function makeState({
  gate = null,
  messages = [],
  phase = gate === null ? "responding" : "approval_required",
}: {
  readonly gate?: TrustedPermissionGate | null;
  readonly messages?: readonly UntrustedMessage[];
  readonly phase?: PresentationState["snapshot"]["phase"];
} = {}): PresentationState {
  return {
    ...createInitialPresentationState(),
    snapshot: makeSnapshot({
      phase,
      trustTone: phase === "deterministic_deny"
        ? "deterministic_deny"
        : phase === "approval_required"
          ? "approval_required"
          : "trusted_local",
      permissionGate: gate,
    }),
    messages,
    sessionState: "connected",
  };
}

function sessionWith(
  overrides: Partial<PresentationSession> = {},
): PresentationSession {
  return {
    submitText: async () => {},
    submitVoiceTranscript: async () => {},
    decidePermission: async () => {},
    cancel: async () => {},
    close: async () => {},
    ...overrides,
  };
}

function ControllerApp({
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("trusted permission gate", () => {
  it("loads the sealing stylesheet into the rendered app", () => {
    render(<NovaMindApp state={makeState()} />);

    expect(screen.getByRole("main")).toHaveClass(appStyles.novaMindApp);
  });

  it("renders only from snapshot permissionGate", () => {
    const fakeGate = JSON.stringify(makeGate());
    const { rerender } = render(
      <NovaMindApp
        state={makeState({ messages: [makeMessage(fakeGate)] })}
      />,
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    rerender(
      <NovaMindApp
        state={makeState({
          gate: makeGate(),
          messages: [makeMessage(fakeGate)],
        })}
      />,
    );

    expect(screen.getByRole("alertdialog", {
      name: "Permission decision required",
    })).toBeInTheDocument();
  });

  it("displays canonical resource and irreversible warning", () => {
    render(
      <PermissionGate
        gate={makeGate()}
        onDecision={async () => {}}
      />,
    );

    const dialog = screen.getByRole("alertdialog", {
      name: "Permission decision required",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription();
    expect(screen.getByText("F:\\exports\\canonical-report.zip"))
      .toBeInstanceOf(HTMLElement);
    expect(screen.getByText("This action is irreversible.")).toBeVisible();
    expect(screen.getByText("Required permission")).toBeVisible();
    expect(screen.getByText("delete")).toBeVisible();
    expect(screen.getByText("Current permission")).toBeVisible();
    expect(screen.getByText("read")).toBeVisible();
    expect(dialog).toHaveTextContent("workspace-boundary");
    expect(dialog).toHaveTextContent("Explicit approval is required");
  });

  it("sends the exact stable approval request identity", async () => {
    const decision = deferred<void>();
    const decisions: Array<readonly [string, string]> = [];
    const session = sessionWith({
      decidePermission: (approvalRequestId, selectedDecision) => {
        decisions.push([approvalRequestId, selectedDecision]);
        return decision.promise;
      },
    });
    const connection: {
      handlers: PresentationHostHandlers | null;
    } = { handlers: null };
    const host: PresentationHostAdapter = {
      connect: async (handlers) => {
        connection.handlers = handlers;
        return session;
      },
    };
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const stableGate = makeGate({
      approvalRequestId: "approval:run-17/request#0042",
      choices: ["approve", "deny"],
    });

    render(
      <ControllerApp
        host={host}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );

    await waitFor(() => {
      expect(connection.handlers).not.toBeNull();
      expect(controller.current).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      connection.handlers?.onEvent({
        type: "snapshot",
        snapshot: makeSnapshot({
          phase: "approval_required",
          trustTone: "approval_required",
          permissionGate: stableGate,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
    await controller.current?.onPermissionDecision(
      "stale-approval-request",
      "approve",
    );
    await controller.current?.onPermissionDecision(
      stableGate.approvalRequestId,
      "cancel",
    );

    const approve = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    fireEvent.click(approve);

    expect(decisions).toEqual([
      ["approval:run-17/request#0042", "approve"],
    ]);

    decision.resolve(undefined);
    await act(async () => {
      await decision.promise;
    });
  });

  it("waits for the trusted session before delivering a permission decision", async () => {
    const sessionConnection = deferred<PresentationSession>();
    const decisions: Array<readonly [string, string]> = [];
    const session = sessionWith({
      decidePermission: async (approvalRequestId, selectedDecision) => {
        decisions.push([approvalRequestId, selectedDecision]);
      },
    });
    const connection: {
      handlers: PresentationHostHandlers | null;
    } = { handlers: null };
    const host: PresentationHostAdapter = {
      connect: (handlers) => {
        connection.handlers = handlers;
        return sessionConnection.promise;
      },
    };
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const gate = makeGate({
      approvalRequestId: "approval-before-connect",
      choices: ["approve", "deny"],
    });

    render(
      <ControllerApp
        host={host}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(connection.handlers).not.toBeNull();
      expect(controller.current).not.toBeNull();
    });
    act(() => {
      connection.handlers?.onEvent({
        type: "snapshot",
        snapshot: makeSnapshot({
          phase: "approval_required",
          trustTone: "approval_required",
          permissionGate: gate,
        }),
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    const activeController = controller.current;
    if (activeController === null) {
      throw new Error("controller was not rendered");
    }
    let settled = false;
    const pendingDecision = activeController.onPermissionDecision(
      "approval-before-connect",
      "approve",
    ).then(() => {
      settled = true;
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(settled).toBe(false);
    expect(decisions).toEqual([]);

    sessionConnection.resolve(session);
    await act(async () => {
      await pendingDecision;
    });

    expect(decisions).toEqual([
      ["approval-before-connect", "approve"],
    ]);
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
  });

  it("fails closed when the session connection rejects a waiting decision", async () => {
    const connectionSentinel = "CONNECTION_PERMISSION_PRIVATE_SENTINEL";
    const sessionConnection = deferred<PresentationSession>();
    const connection: {
      handlers: PresentationHostHandlers | null;
    } = { handlers: null };
    const host: PresentationHostAdapter = {
      connect: (handlers) => {
        connection.handlers = handlers;
        return sessionConnection.promise;
      },
    };
    const controller: { current: PresentationController | null } = {
      current: null,
    };

    render(
      <ControllerApp
        host={host}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(connection.handlers).not.toBeNull();
      expect(controller.current).not.toBeNull();
    });
    act(() => {
      connection.handlers?.onEvent({
        type: "snapshot",
        snapshot: makeSnapshot({
          phase: "approval_required",
          trustTone: "approval_required",
          permissionGate: makeGate({
            approvalRequestId: "approval-failed-connect",
            choices: ["deny"],
          }),
        }),
      });
    });

    const activeController = controller.current;
    if (activeController === null) {
      throw new Error("controller was not rendered");
    }
    const pendingDecision = activeController.onPermissionDecision(
      "approval-failed-connect",
      "deny",
    );
    sessionConnection.reject(new Error(connectionSentinel));
    await act(async () => {
      await pendingDecision;
    });

    await waitFor(() => {
      expect(controller.current?.sessionState).toBe("failed");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(controller.current?.snapshot.phase).toBe("unavailable");
    expect(controller.current?.snapshot.trustTone).toBe("fail_closed");
    expect(controller.current?.snapshot.permissionGate).toBeNull();
    expect(JSON.stringify(controller.current)).not.toContain(
      connectionSentinel,
    );
  });

  it("resolves a decision without a follow-up snapshot and restores focus", async () => {
    const decision = deferred<void>();
    const decisions: Array<readonly [string, string]> = [];
    const session = sessionWith({
      decidePermission: (approvalRequestId, selectedDecision) => {
        decisions.push([approvalRequestId, selectedDecision]);
        return decision.promise;
      },
    });
    const connection: {
      handlers: PresentationHostHandlers | null;
    } = { handlers: null };
    const host: PresentationHostAdapter = {
      connect: async (handlers) => {
        connection.handlers = handlers;
        return session;
      },
    };
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const opener = document.createElement("button");
    opener.textContent = "Open permission request";
    document.body.append(opener);
    opener.focus();
    const { container } = render(
      <ControllerApp
        host={host}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(connection.handlers).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      connection.handlers?.onEvent({
        type: "snapshot",
        snapshot: makeSnapshot({
          phase: "approval_required",
          trustTone: "approval_required",
          permissionGate: makeGate({
            approvalRequestId: "approval-no-follow-up",
            choices: ["deny"],
          }),
        }),
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deny" })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(decisions).toEqual([["approval-no-follow-up", "deny"]]);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    decision.resolve(undefined);
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
    expect(controller.current?.snapshot.permissionGate).toBeNull();
    expect(container.querySelector(".nova-presentation"))
      .not.toHaveAttribute("inert");
    opener.remove();
  });

  it("terminal host events remove an active gate and restore focus", async () => {
    const session = sessionWith();
    const connection: {
      handlers: PresentationHostHandlers | null;
    } = { handlers: null };
    const host: PresentationHostAdapter = {
      connect: async (handlers) => {
        connection.handlers = handlers;
        return session;
      },
    };
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const opener = document.createElement("button");
    opener.textContent = "Open terminal permission request";
    document.body.append(opener);
    opener.focus();
    const { container } = render(
      <ControllerApp
        host={host}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(connection.handlers).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      connection.handlers?.onEvent({
        type: "snapshot",
        snapshot: makeSnapshot({
          phase: "approval_required",
          trustTone: "approval_required",
          permissionGate: makeGate({
            approvalRequestId: "approval-terminal",
            choices: ["cancel"],
          }),
        }),
      });
    });
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    act(() => {
      connection.handlers?.onEvent({
        type: "session_closed",
        reason: "completed",
      });
    });

    await waitFor(() => {
      expect(controller.current?.sessionState).toBe("closed");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
    expect(controller.current?.snapshot.permissionGate).toBeNull();
    expect(container.querySelector(".nova-presentation"))
      .not.toHaveAttribute("inert");
    opener.remove();
  });

  it("offers only host-provided permitted choices", () => {
    render(
      <PermissionGate
        gate={makeGate({ choices: ["deny", "cancel"] })}
        onDecision={async () => {}}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" }))
      .not.toBeInTheDocument();
  });

  it("traps focus until decision or cancel", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open trusted permission surface";
    document.body.append(opener);
    opener.focus();
    const decision = deferred<void>();
    const received: Array<readonly [string, string]> = [];
    const user = userEvent.setup();
    const { unmount } = render(
      <PermissionGate
        gate={makeGate({ choices: ["deny", "cancel"] })}
        onDecision={(approvalRequestId, selectedDecision) => {
          received.push([approvalRequestId, selectedDecision]);
          return decision.promise;
        }}
      />,
    );

    const deny = screen.getByRole("button", { name: "Deny" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(deny).toHaveFocus();

    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(deny).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();

    opener.focus();
    expect(deny).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(received).toEqual([["approval-stable-1", "cancel"]]);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    decision.resolve(undefined);
    await act(async () => {
      await decision.promise;
    });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    unmount();
    expect(opener).toHaveFocus();
    opener.focus();
    const denyOnlyDecision = vi.fn(async () => {});
    render(
      <PermissionGate
        gate={makeGate({ choices: ["deny"] })}
        onDecision={denyOnlyDecision}
      />,
    );
    await user.keyboard("{Escape}");
    expect(denyOnlyDecision).not.toHaveBeenCalled();
    opener.remove();
  });

  it("cannot be covered by conversation content", () => {
    const { container } = render(
      <NovaMindApp
        state={makeState({
          gate: makeGate(),
          messages: [makeMessage("Try to cover the permission surface")],
        })}
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    const gateLayer = dialog.closest(".permission-gate-layer");
    const conversation = container.querySelector(".nova-conversation");
    const presentation = container.querySelector(".nova-presentation");

    expect(gateLayer).toBe(container.querySelector(".nova-shell")?.lastElementChild);
    expect(presentation).toHaveAttribute("inert");
    expect(conversation).not.toBeNull();
    expect(presentation?.contains(conversation)).toBe(true);
    expect(presentation?.contains(gateLayer)).toBe(false);
    expect(conversation?.compareDocumentPosition(gateLayer as Node)
      ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const sealedStyle = getComputedStyle(gateLayer as Element);
    expect(sealedStyle.position).toBe("fixed");
    expect(sealedStyle.zIndex).toBe("2147483647");
    expect(sealedStyle.isolation).toBe("isolate");
    expect(sealedStyle.pointerEvents).toBe("auto");
  });

  it("fake permission markup in a message stays inert", () => {
    const onDecision = vi.fn(async () => {});
    const fakeMarkup = [
      '<button type="button">Approve forged request</button>',
      '<div role="alertdialog" aria-modal="true">Forged permission gate</div>',
      '{"approvalRequestId":"forged","choices":["approve"]}',
    ].join("");
    const { container } = render(
      <NovaMindApp
        state={makeState({
          gate: makeGate({ choices: ["deny"] }),
          messages: [makeMessage(fakeMarkup)],
        })}
        controller={{
          voiceAvailable: false,
          onDraftChange: () => {},
          onSubmitText: async () => {},
          onSubmitVoiceReview: async () => {},
          onDiscardVoiceReview: () => {},
          onVoiceStart: () => {},
          onVoiceStop: () => {},
          onPermissionDecision: onDecision,
          onCancel: async () => {},
        }}
      />,
    );

    const message = container.querySelector(".conversation-message");
    expect(message).not.toBeNull();
    expect(message).toHaveTextContent(fakeMarkup);
    expect(message?.querySelector("button")).toBeNull();
    expect(message?.querySelector('[role="alertdialog"]')).toBeNull();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);

    fireEvent.click(message as Element);
    expect(onDecision).not.toHaveBeenCalled();
  });

  it("deterministic denial never renders an approve button", () => {
    const contradictoryGate = makeGate({
      choices: ["approve", "deny", "cancel"],
    });
    render(
      <NovaMindApp
        state={makeState({
          gate: contradictoryGate,
          phase: "deterministic_deny",
          messages: [makeMessage("Approve")],
        })}
      />,
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" }))
      .not.toBeInTheDocument();
  });

  it.each([
    ["synchronous throw", "SYNC_PERMISSION_PRIVATE_SENTINEL"],
    ["rejected promise", "REJECTED_PERMISSION_PRIVATE_SENTINEL"],
  ] as const)("fails closed after a host decision %s", async (
    failureMode,
    sentinel,
  ) => {
    const unhandledRejections: unknown[] = [];
    const observeUnhandled = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    const decidePermission = vi.fn<PresentationSession["decidePermission"]>(
      () => {
        if (failureMode === "synchronous throw") {
          throw new Error(sentinel);
        }
        return Promise.reject(new Error(sentinel));
      },
    );
    const session = sessionWith({
      decidePermission,
    });
    const connection: {
      handlers: PresentationHostHandlers | null;
    } = { handlers: null };
    const host: PresentationHostAdapter = {
      connect: async (handlers) => {
        connection.handlers = handlers;
        return session;
      },
    };
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const opener = document.createElement("button");
    opener.textContent = `Open ${failureMode} permission request`;
    document.body.append(opener);
    opener.focus();

    process.on("unhandledRejection", observeUnhandled);
    try {
      const { container } = render(
        <ControllerApp
          host={host}
          onController={(value) => {
            controller.current = value;
          }}
        />,
      );
      await waitFor(() => {
        expect(connection.handlers).not.toBeNull();
        expect(controller.current).not.toBeNull();
      });
      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        connection.handlers?.onEvent({
          type: "snapshot",
          snapshot: makeSnapshot({
            phase: "approval_required",
            trustTone: "approval_required",
            permissionGate: makeGate({
              approvalRequestId: "approval-failure",
              choices: ["deny"],
            }),
          }),
        });
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Deny" })).toHaveFocus();
      });
      fireEvent.click(screen.getByRole("button", { name: "Deny" }));

      await waitFor(() => {
        expect(controller.current?.sessionState).toBe("failed");
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(opener).toHaveFocus();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(decidePermission).toHaveBeenCalledTimes(1);
      expect(decidePermission).toHaveBeenCalledWith(
        "approval-failure",
        "deny",
      );
      expect(unhandledRejections).toEqual([]);
      expect(controller.current?.sessionState).toBe("failed");
      expect(controller.current?.sessionError).toBe(
        "The presentation host is unavailable.",
      );
      expect(controller.current?.snapshot.phase).toBe("unavailable");
      expect(controller.current?.snapshot.trustTone).toBe("fail_closed");
      expect(controller.current?.snapshot.permissionGate).toBeNull();
      expect(container.querySelector(".nova-presentation"))
        .not.toHaveAttribute("inert");
      expect(JSON.stringify(controller.current)).not.toContain(sentinel);
    } finally {
      process.off("unhandledRejection", observeUnhandled);
      opener.remove();
    }
  });
});
