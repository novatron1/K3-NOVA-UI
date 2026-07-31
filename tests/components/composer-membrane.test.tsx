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
  type PresentationControllerActions,
  usePresentationController,
} from "../../src/state/use-presentation-controller";
import {
  createInitialPresentationState,
  type PresentationState,
} from "../../src/state/presentation-reducer";
import { makeSnapshot } from "../../src/test/fixtures";
import { UnavailableVoiceCapture } from "../../src/voice/voice-capture";

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: () => {
      resolvePromise?.();
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ComposerMembrane", () => {
  it("submits nonempty text exactly once", async () => {
    const submission = deferred();
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
      submission.resolve();
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
    const cancellationFinished = deferred();
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
      cancellationFinished.resolve();
      await cancellationFinished.promise;
    });
  });
});
