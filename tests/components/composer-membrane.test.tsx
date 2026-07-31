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
import { ComposerMembrane } from "../../src/components/ComposerMembrane";
import type { ComposerMembraneProps } from "../../src/components/ComposerMembrane";
import type {
  PresentationHostAdapter,
  PresentationSession,
} from "../../src/host/presentation-host";
import {
  type PresentationController,
  type PresentationControllerActions,
  usePresentationController,
} from "../../src/state/use-presentation-controller";
import {
  createInitialPresentationState,
  type PresentationState,
} from "../../src/state/presentation-reducer";
import { makeSnapshot } from "../../src/test/fixtures";
import {
  UnavailableVoiceCapture,
  type VoiceCaptureAdapter,
} from "../../src/voice/voice-capture";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value) => {
      resolvePromise?.(value);
    },
  };
}

const inactiveActions: PresentationControllerActions = {
  voiceAvailable: false,
  onDraftChange: () => {},
  onSubmitText: async () => {},
  onSubmitVoiceReview: async () => {},
  onDiscardVoiceReview: () => {},
  onVoiceStart: () => {},
  onVoiceStop: () => {},
  onOrganToggle: () => {},
  onPermissionDecision: async () => {},
  onCancel: async () => {},
};

function baseProps(
  overrides: Partial<ComposerMembraneProps> = {},
): ComposerMembraneProps {
  return {
    draft: "",
    voiceReview: null,
    privacyClass: "private",
    cloudConsentRequired: false,
    busy: false,
    voiceAvailable: false,
    onDraftChange: () => {},
    onSubmitText: async () => {},
    onSubmitVoiceReview: async () => {},
    onDiscardVoiceReview: () => {},
    onCancel: async () => {},
    ...overrides,
  };
}

function ControllerComposer({ host }: {
  readonly host: PresentationHostAdapter;
}) {
  const [voice] = useState(() => new UnavailableVoiceCapture());
  const controller = usePresentationController(host, voice);

  return (
    <ComposerMembrane
      draft={controller.draft}
      voiceReview={controller.voiceReview}
      privacyClass={controller.snapshot.privacyClass}
      cloudConsentRequired={controller.snapshot.cloudConsentRequired}
      busy={controller.snapshot.phase === "processing"}
      voiceAvailable={controller.voiceAvailable}
      onDraftChange={controller.onDraftChange}
      onSubmitText={controller.onSubmitText}
      onSubmitVoiceReview={controller.onSubmitVoiceReview}
      onDiscardVoiceReview={controller.onDiscardVoiceReview}
      onCancel={controller.onCancel}
    />
  );
}

function ControllerApp({
  host,
  voice,
  onController,
}: {
  readonly host: PresentationHostAdapter;
  readonly voice: VoiceCaptureAdapter;
  readonly onController: (controller: PresentationController) => void;
}) {
  const controller = usePresentationController(host, voice);
  onController(controller);
  return <NovaMindApp state={controller} controller={controller} />;
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ComposerMembrane", () => {
  it("submits nonempty text exactly once", async () => {
    const submission = deferred<void>();
    const receivedTexts: string[] = [];
    const session: PresentationSession = {
      submitText: (text) => {
        receivedTexts.push(text);
        return submission.promise;
      },
      submitVoiceTranscript: async () => {},
      decidePermission: async () => {},
      cancel: async () => {},
      close: async () => {},
    };
    const host: PresentationHostAdapter = {
      connect: async () => session,
    };
    const user = userEvent.setup();

    render(<ControllerComposer host={host} />);
    const textbox = screen.getByRole("textbox", { name: "Message" });
    await user.type(textbox, "Keep this private");
    const submit = screen.getByRole("button", { name: "Send message" });
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(receivedTexts).toEqual(["Keep this private"]);
    expect(textbox).toHaveValue("Keep this private");

    await act(async () => {
      submission.resolve(undefined);
      await submission.promise;
    });

    await waitFor(() => {
      expect(textbox).toHaveValue("");
    });
  });

  it("does not persist draft or transcript to browser storage", async () => {
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    const indexedDbOpen = vi.fn();
    const cacheOpen = vi.fn();
    const serviceWorkerRegister = vi.fn();
    const fetchCall = vi.fn();
    vi.stubGlobal("indexedDB", { open: indexedDbOpen });
    vi.stubGlobal("caches", { open: cacheOpen });
    vi.stubGlobal("fetch", fetchCall);
    const workerDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "serviceWorker",
    );
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: serviceWorkerRegister },
    });

    function PrivateInputHarness() {
      const [draft, setDraft] = useState("");
      const [voiceReview, setVoiceReview] = useState<string | null>(
        "PRIVATE_TRANSCRIPT_SENTINEL_93A6",
      );
      return (
        <ComposerMembrane
          {...baseProps({
            draft,
            voiceReview,
            onDraftChange: setDraft,
            onDiscardVoiceReview: () => {
              setVoiceReview(null);
            },
          })}
        />
      );
    }

    try {
      const user = userEvent.setup();
      render(<PrivateInputHarness />);
      await user.type(
        screen.getByRole("textbox", { name: "Message" }),
        "PRIVATE_DRAFT_SENTINEL_F41D",
      );
      await user.click(
        screen.getByRole("button", { name: "Discard voice transcript" }),
      );

      expect(storageWrite).not.toHaveBeenCalled();
      expect(indexedDbOpen).not.toHaveBeenCalled();
      expect(cacheOpen).not.toHaveBeenCalled();
      expect(serviceWorkerRegister).not.toHaveBeenCalled();
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState).not.toHaveBeenCalled();
      expect(fetchCall).not.toHaveBeenCalled();
    } finally {
      if (workerDescriptor === undefined) {
        Reflect.deleteProperty(navigator, "serviceWorker");
      } else {
        Object.defineProperty(navigator, "serviceWorker", workerDescriptor);
      }
    }
  });

  it("shows privacy label before submission", () => {
    render(
      <ComposerMembrane
        {...baseProps({
          draft: "Private draft",
          privacyClass: "restricted",
          cloudConsentRequired: true,
        })}
      />,
    );

    const textbox = screen.getByRole("textbox", { name: "Message" });
    expect(screen.getByText("Privacy: restricted")).toBeVisible();
    expect(screen.getByText("Cloud consent required before submission"))
      .toBeVisible();
    expect(
      textbox.compareDocumentPosition(
        screen.getByRole("button", { name: "Send message" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps private voice transcript in review until confirmed", async () => {
    const submittedTranscripts: string[] = [];

    function VoiceReviewHarness() {
      const [voiceReview, setVoiceReview] = useState<string | null>(
        "Review this private transcript",
      );
      return (
        <ComposerMembrane
          {...baseProps({
            voiceReview,
            onSubmitVoiceReview: async () => {
              submittedTranscripts.push(voiceReview ?? "");
              setVoiceReview(null);
            },
            onDiscardVoiceReview: () => {
              setVoiceReview(null);
            },
          })}
        />
      );
    }

    const user = userEvent.setup();
    render(<VoiceReviewHarness />);

    expect(screen.getByText("Review this private transcript")).toBeVisible();
    expect(submittedTranscripts).toEqual([]);

    await user.click(
      screen.getByRole("button", { name: "Confirm voice transcript" }),
    );

    expect(submittedTranscripts).toEqual(["Review this private transcript"]);
    expect(screen.queryByText("Review this private transcript"))
      .not.toBeInTheDocument();
  });

  it("disables live voice when the adapter is unavailable", () => {
    render(<ComposerMembrane {...baseProps({ voiceAvailable: false })} />);

    const voice = screen.getByRole("button", {
      name: "Voice capture unavailable",
    });
    expect(voice).toBeDisabled();
    expect(voice).toHaveTextContent("Voice unavailable");
  });

  it("cancel remains enabled while processing", () => {
    const state: PresentationState = {
      ...createInitialPresentationState(),
      snapshot: makeSnapshot({ phase: "processing" }),
    };

    render(
      <NovaMindApp
        state={state}
        controller={{ ...inactiveActions, voiceAvailable: false }}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel presentation" }))
      .toBeEnabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("cancel aborts presentation work immediately", async () => {
    let presentationWorkPending = true;
    let sessionConnected = false;
    const cancellationFinished = deferred<void>();
    const session: PresentationSession = {
      submitText: async () => {},
      submitVoiceTranscript: async () => {},
      decidePermission: async () => {},
      cancel: () => {
        presentationWorkPending = false;
        return cancellationFinished.promise;
      },
      close: async () => {},
    };
    const host: PresentationHostAdapter = {
      connect: async () => {
        sessionConnected = true;
        return session;
      },
    };

    render(<ControllerComposer host={host} />);
    await waitFor(() => {
      expect(sessionConnected).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel presentation" }),
    );

    expect(presentationWorkPending).toBe(false);

    await act(async () => {
      cancellationFinished.resolve(undefined);
      await cancellationFinished.promise;
    });
  });

  it("cancels a session that connects after cancellation was requested", async () => {
    const connection = deferred<PresentationSession>();
    let connectStarted = false;
    let cancelCount = 0;
    let closeCount = 0;
    const lateSession = sessionWith({
      cancel: async () => {
        cancelCount += 1;
      },
      close: async () => {
        closeCount += 1;
      },
    });
    const host: PresentationHostAdapter = {
      connect: () => {
        connectStarted = true;
        return connection.promise;
      },
    };

    render(<ControllerComposer host={host} />);
    await waitFor(() => {
      expect(connectStarted).toBe(true);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel presentation" }),
    );

    await act(async () => {
      connection.resolve(lateSession);
      await connection.promise;
    });

    await waitFor(() => {
      expect(cancelCount).toBe(1);
    });
    expect(closeCount).toBe(0);
  });

  it("preserves a newer draft when an older text submission resolves", async () => {
    const submission = deferred<void>();
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const submittedTexts: string[] = [];
    const session = sessionWith({
      submitText: (text) => {
        submittedTexts.push(text);
        return submission.promise;
      },
    });
    const host: PresentationHostAdapter = { connect: async () => session };
    const voice = new UnavailableVoiceCapture();
    render(
      <ControllerApp
        host={host}
        voice={voice}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(controller.current).not.toBeNull();
    });

    await act(async () => {
      controller.current?.onDraftChange("first draft");
    });
    const firstSubmission = controller.current?.onSubmitText();
    expect(submittedTexts).toEqual(["first draft"]);

    controller.current?.onDraftChange("newer draft");
    submission.resolve(undefined);
    await firstSubmission;

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Message" }))
        .toHaveValue("newer draft");
    });
  });

  it("preserves a newer transcript when an older voice submission resolves", async () => {
    const voiceSubmission = deferred<void>();
    const firstStop = deferred<string>();
    const secondStop = deferred<string>();
    const stops = [firstStop.promise, secondStop.promise];
    let stopIndex = 0;
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const voice: VoiceCaptureAdapter = {
      available: true,
      start: async () => {},
      stopForReview: () => stops[stopIndex++] ?? Promise.resolve("unexpected"),
      cancel: async () => {},
    };
    const session = sessionWith({
      submitVoiceTranscript: () => voiceSubmission.promise,
    });
    const host: PresentationHostAdapter = { connect: async () => session };
    render(
      <ControllerApp
        host={host}
        voice={voice}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );

    await waitFor(() => {
      expect(controller.current).not.toBeNull();
    });
    controller.current?.onVoiceStop();
    await act(async () => {
      firstStop.resolve("first transcript");
      await firstStop.promise;
    });
    await waitFor(() => {
      expect(screen.getByText("first transcript")).toBeVisible();
    });

    const firstSubmission = controller.current?.onSubmitVoiceReview();
    controller.current?.onDiscardVoiceReview();
    controller.current?.onVoiceStop();
    secondStop.resolve("newer transcript");
    voiceSubmission.resolve(undefined);
    await secondStop.promise;
    await voiceSubmission.promise;
    await firstSubmission;

    await waitFor(() => {
      expect(screen.getByText("newer transcript")).toBeVisible();
    });
  });

  it("serializes voice stops and blocks capture while review is pending", async () => {
    const stop = deferred<string>();
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    let startCount = 0;
    let stopCount = 0;
    const voice: VoiceCaptureAdapter = {
      available: true,
      start: async () => {
        startCount += 1;
      },
      stopForReview: () => {
        stopCount += 1;
        return stop.promise;
      },
      cancel: async () => {},
    };
    const host: PresentationHostAdapter = {
      connect: async () => sessionWith(),
    };
    render(
      <ControllerApp
        host={host}
        voice={voice}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(controller.current).not.toBeNull();
    });

    controller.current?.onVoiceStop();
    controller.current?.onVoiceStop();
    expect(stopCount).toBe(1);

    await act(async () => {
      stop.resolve("review before another capture");
      await stop.promise;
    });
    await waitFor(() => {
      expect(screen.getByText("review before another capture")).toBeVisible();
    });

    controller.current?.onVoiceStart();
    expect(startCount).toBe(0);
    act(() => {
      controller.current?.onDiscardVoiceReview();
    });
    controller.current?.onVoiceStart();
    expect(startCount).toBe(1);
  });

  it("becomes terminal and non-busy before cancellation work resolves", async () => {
    const cancellation = deferred<void>();
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const session = sessionWith({ cancel: () => cancellation.promise });
    const host: PresentationHostAdapter = {
      connect: async (handlers) => {
        handlers.onEvent({
          type: "snapshot",
          snapshot: makeSnapshot({ phase: "processing" }),
        });
        return session;
      },
    };
    render(
      <ControllerApp
        host={host}
        voice={new UnavailableVoiceCapture()}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(controller.current?.sessionState).toBe("connected");
      expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel presentation" }),
    );

    await waitFor(() => {
      expect(controller.current?.sessionState).toBe("closed");
      expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
    });

    await act(async () => {
      cancellation.resolve(undefined);
      await cancellation.promise;
    });
  });

  it("contains synchronous cancellation failures and continues teardown", async () => {
    const sessionSentinel = "SYNC_SESSION_CANCEL_PRIVATE_SENTINEL";
    const voiceSentinel = "SYNC_VOICE_CANCEL_PRIVATE_SENTINEL";
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    let connectedSignal: AbortSignal | null = null;
    let voiceCancelCount = 0;
    const session = sessionWith({
      cancel: () => {
        throw new Error(sessionSentinel);
      },
    });
    const host: PresentationHostAdapter = {
      connect: async (_handlers, signal) => {
        connectedSignal = signal;
        return session;
      },
    };
    const voice: VoiceCaptureAdapter = {
      available: false,
      start: async () => {},
      stopForReview: async () => "",
      cancel: () => {
        voiceCancelCount += 1;
        throw new Error(voiceSentinel);
      },
    };
    render(
      <ControllerApp
        host={host}
        voice={voice}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(controller.current).not.toBeNull();
      expect(connectedSignal).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });

    let cancellationFailure: unknown = null;
    try {
      await act(async () => {
        await controller.current?.onCancel();
      });
    } catch (error: unknown) {
      cancellationFailure = error;
    }

    expect(cancellationFailure).toBeNull();
    expect((connectedSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(voiceCancelCount).toBe(1);
    expect(controller.current?.sessionState).toBe("closed");
    expect(JSON.stringify(controller.current)).not.toContain(sessionSentinel);
    expect(JSON.stringify(controller.current)).not.toContain(voiceSentinel);
  });

  it("contains rejected cancellation promises without an unhandled rejection", async () => {
    const sessionSentinel = "REJECTED_SESSION_CANCEL_PRIVATE_SENTINEL";
    const voiceSentinel = "REJECTED_VOICE_CANCEL_PRIVATE_SENTINEL";
    const unhandledRejections: unknown[] = [];
    const observeUnhandled = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", observeUnhandled);
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    const session = sessionWith({
      cancel: () => Promise.reject(new Error(sessionSentinel)),
    });
    const host: PresentationHostAdapter = { connect: async () => session };
    const voice: VoiceCaptureAdapter = {
      available: false,
      start: async () => {},
      stopForReview: async () => "",
      cancel: () => Promise.reject(new Error(voiceSentinel)),
    };

    try {
      render(
        <ControllerApp
          host={host}
          voice={voice}
          onController={(value) => {
            controller.current = value;
          }}
        />,
      );
      await waitFor(() => {
        expect(controller.current).not.toBeNull();
      });
      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Cancel presentation" }),
      );
      await waitFor(() => {
        expect(controller.current?.sessionState).toBe("closed");
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(unhandledRejections).toEqual([]);
      expect(JSON.stringify(controller.current)).not.toContain(sessionSentinel);
      expect(JSON.stringify(controller.current)).not.toContain(voiceSentinel);
    } finally {
      process.off("unhandledRejection", observeUnhandled);
    }
  });

  it.each([
    {
      kind: "text",
      failureMode: "synchronous throw",
      sentinel: "SYNC_TEXT_SUBMIT_PRIVATE_SENTINEL_4C31",
    },
    {
      kind: "text",
      failureMode: "rejected promise",
      sentinel: "REJECTED_TEXT_SUBMIT_PRIVATE_SENTINEL_A817",
    },
    {
      kind: "voice",
      failureMode: "synchronous throw",
      sentinel: "SYNC_VOICE_SUBMIT_PRIVATE_SENTINEL_96D2",
    },
    {
      kind: "voice",
      failureMode: "rejected promise",
      sentinel: "REJECTED_VOICE_SUBMIT_PRIVATE_SENTINEL_7BE5",
    },
  ] as const)(
    "contains $failureMode from $kind submission",
    async ({ kind, failureMode, sentinel }) => {
      const privateInput = kind === "text"
        ? "private draft survives submission failure"
        : "private transcript survives submission failure";
      const unhandledRejections: unknown[] = [];
      const observeUnhandled = (reason: unknown): void => {
        unhandledRejections.push(reason);
      };
      const submittedInputs: string[] = [];
      const failingSubmission = (value: string): Promise<void> => {
        submittedInputs.push(value);
        if (failureMode === "synchronous throw") {
          throw new Error(sentinel);
        }
        return Promise.reject(new Error(sentinel));
      };
      const session = sessionWith({
        ...(kind === "text"
          ? { submitText: failingSubmission }
          : { submitVoiceTranscript: failingSubmission }),
      });
      const host: PresentationHostAdapter = { connect: async () => session };
      const voice: VoiceCaptureAdapter = kind === "voice"
        ? {
            available: true,
            start: async () => {},
            stopForReview: async () => privateInput,
            cancel: async () => {},
          }
        : new UnavailableVoiceCapture();
      const controller: { current: PresentationController | null } = {
        current: null,
      };

      process.on("unhandledRejection", observeUnhandled);
      try {
        render(
          <ControllerApp
            host={host}
            voice={voice}
            onController={(value) => {
              controller.current = value;
            }}
          />,
        );
        await waitFor(() => {
          expect(controller.current).not.toBeNull();
        });
        await act(async () => {
          await Promise.resolve();
        });

        if (kind === "text") {
          act(() => {
            controller.current?.onDraftChange(privateInput);
          });
        } else {
          controller.current?.onVoiceStop();
          await waitFor(() => {
            expect(screen.getByText(privateInput)).toBeVisible();
          });
        }

        const submit = screen.getByRole("button", {
          name: kind === "text"
            ? "Send message"
            : "Confirm voice transcript",
        });
        fireEvent.click(submit);
        await waitFor(() => {
          expect(submittedInputs).toEqual([privateInput]);
          expect(submit).toBeEnabled();
        });

        fireEvent.click(submit);
        await waitFor(() => {
          expect(submittedInputs).toEqual([privateInput, privateInput]);
          expect(submit).toBeEnabled();
        });
        await act(async () => {
          await Promise.resolve();
        });

        expect(unhandledRejections).toEqual([]);
        expect(controller.current?.sessionError).toBeNull();
        if (kind === "text") {
          expect(screen.getByRole("textbox", { name: "Message" }))
            .toHaveValue(privateInput);
        } else {
          expect(screen.getByText(privateInput)).toBeVisible();
        }
        expect(JSON.stringify(controller.current)).not.toContain(sentinel);
      } finally {
        process.off("unhandledRejection", observeUnhandled);
      }
    },
  );

  it("preserves a newer same-value draft revision after old submission", async () => {
    const submission = deferred<void>();
    const submittedInputs: string[] = [];
    const session = sessionWith({
      submitText: (value) => {
        submittedInputs.push(value);
        return submission.promise;
      },
    });
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    render(
      <ControllerApp
        host={{ connect: async () => session }}
        voice={new UnavailableVoiceCapture()}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(controller.current).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      controller.current?.onDraftChange("same-value draft");
    });
    const oldSubmission = controller.current?.onSubmitText();
    expect(submittedInputs).toEqual(["same-value draft"]);

    act(() => {
      controller.current?.onDraftChange("intermediate draft");
      controller.current?.onDraftChange("same-value draft");
    });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Message" }))
        .toHaveValue("same-value draft");
    });
    await act(async () => {
      submission.resolve(undefined);
      await oldSubmission;
    });

    expect(screen.getByRole("textbox", { name: "Message" }))
      .toHaveValue("same-value draft");
  });

  it("preserves a newer same-value voice revision after old submission", async () => {
    const submission = deferred<void>();
    const transcripts = [
      "same-value transcript",
      "intermediate transcript",
      "same-value transcript",
    ];
    let transcriptIndex = 0;
    const voice: VoiceCaptureAdapter = {
      available: true,
      start: async () => {},
      stopForReview: async () => (
        transcripts[transcriptIndex++] ?? "unexpected transcript"
      ),
      cancel: async () => {},
    };
    const submittedInputs: string[] = [];
    const session = sessionWith({
      submitVoiceTranscript: (value) => {
        submittedInputs.push(value);
        return submission.promise;
      },
    });
    const controller: { current: PresentationController | null } = {
      current: null,
    };
    render(
      <ControllerApp
        host={{ connect: async () => session }}
        voice={voice}
        onController={(value) => {
          controller.current = value;
        }}
      />,
    );
    await waitFor(() => {
      expect(controller.current).not.toBeNull();
    });
    await act(async () => {
      await Promise.resolve();
    });

    controller.current?.onVoiceStop();
    await waitFor(() => {
      expect(screen.getByText("same-value transcript")).toBeVisible();
    });
    const oldSubmission = controller.current?.onSubmitVoiceReview();
    expect(submittedInputs).toEqual(["same-value transcript"]);

    act(() => {
      controller.current?.onDiscardVoiceReview();
    });
    controller.current?.onVoiceStop();
    await waitFor(() => {
      expect(screen.getByText("intermediate transcript")).toBeVisible();
    });
    act(() => {
      controller.current?.onDiscardVoiceReview();
    });
    controller.current?.onVoiceStop();
    await waitFor(() => {
      expect(screen.getByText("same-value transcript")).toBeVisible();
    });

    await act(async () => {
      submission.resolve(undefined);
      await oldSubmission;
    });

    expect(screen.getByText("same-value transcript")).toBeVisible();
  });
});
