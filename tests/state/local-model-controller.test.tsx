import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  LocalModelInventory,
  LocalModelSelection,
  LocalModelStatus,
} from "../../src/domain/local-models";
import type {
  PresentationHostAdapter,
  PresentationHostHandlers,
  PresentationSession,
} from "../../src/host/presentation-host";
import { usePresentationController } from "../../src/state/use-presentation-controller";
import type { VoiceCaptureAdapter } from "../../src/voice/voice-capture";

const DOLPHIN_ID = `local_${"a".repeat(64)}`;
const NOVA_ID = `local_${"b".repeat(64)}`;

function inventory(
  version = 1,
  selection: LocalModelSelection = Object.freeze({
    mode: "auto-local",
    modelId: null,
  }),
): LocalModelInventory {
  return Object.freeze({
    version,
    scannedAt: `2026-08-16T18:20:0${Math.min(version, 9)}+00:00`,
    selection,
    models: Object.freeze([
      Object.freeze({
        modelId: DOLPHIN_ID,
        displayName: "Dolphin Mixtral 8x7B",
        engine: "ollama",
        source: "ollama",
        sizeBytes: 31_000_000_000,
        parameterCount: 47_000_000_000,
        quantization: "Q4_0",
        contextLength: 32_768,
        capabilities: Object.freeze({
          text: true,
          vision: false,
          tools: false,
          embeddings: false,
          reasoning: false,
        }),
        runtimeState: "ready",
        failureCode: null,
      }),
      Object.freeze({
        modelId: NOVA_ID,
        displayName: "Nova Trained 1.5B",
        engine: "ollama",
        source: "ollama",
        sizeBytes: 986_000_000,
        parameterCount: 1_500_000_000,
        quantization: "Q4_K_M",
        contextLength: 32_768,
        capabilities: Object.freeze({
          text: true,
          vision: false,
          tools: true,
          embeddings: false,
          reasoning: false,
        }),
        runtimeState: "ready",
        failureCode: null,
      }),
    ]),
  });
}

function voice(): VoiceCaptureAdapter {
  return {
    available: false,
    start: async () => undefined,
    stopForReview: async () => "",
    cancel: async () => undefined,
  };
}

interface Harness {
  readonly host: PresentationHostAdapter;
  readonly getHandlers: () => PresentationHostHandlers;
  readonly scan: ReturnType<typeof vi.fn>;
  readonly select: ReturnType<typeof vi.fn>;
  readonly status: ReturnType<typeof vi.fn>;
}

function harness(): Harness {
  let handlers: PresentationHostHandlers | null = null;
  let currentInventory = inventory();
  const scan = vi.fn(async (): Promise<LocalModelInventory> => {
    currentInventory = inventory(2, currentInventory.selection);
    return currentInventory;
  });
  const select = vi.fn(async (
    selection: LocalModelSelection,
  ): Promise<LocalModelInventory> => {
    currentInventory = inventory(3, selection);
    return currentInventory;
  });
  const status = vi.fn(async (): Promise<LocalModelStatus> => Object.freeze({
    selection: currentInventory.selection,
    answeringModel: Object.freeze({
      modelId: DOLPHIN_ID,
      displayName: "Dolphin Mixtral 8x7B",
      engine: "ollama",
    }),
  }));

  const session: PresentationSession = {
    submitText: async () => undefined,
    submitVoiceTranscript: async () => undefined,
    decidePermission: async () => undefined,
    getLocalModels: async () => currentInventory,
    scanLocalModels: scan,
    setLocalModelSelection: select,
    getLocalModelStatus: status,
    cancel: async () => undefined,
    close: async () => undefined,
  };
  const host: PresentationHostAdapter = {
    connect: async (value) => {
      handlers = value;
      return session;
    },
  };

  return {
    host,
    getHandlers: () => {
      if (handlers === null) {
        throw new Error("presentation host has not connected yet");
      }
      return handlers;
    },
    scan,
    select,
    status,
  };
}

describe("usePresentationController local models", () => {
  it("loads canonical local model inventory when the connected session supports it", async () => {
    const test = harness();
    const capture = voice();
    const { result } = renderHook(() => usePresentationController(test.host, capture));

    await waitFor(() => expect(result.current.localModelControlAvailable).toBe(true));

    expect(result.current.localModels).toHaveLength(2);
    expect(result.current.localModelSelection).toEqual({
      mode: "auto-local",
      modelId: null,
    });
  });

  it("rescans and updates only from the backend-returned canonical inventory", async () => {
    const test = harness();
    const capture = voice();
    const { result } = renderHook(() => usePresentationController(test.host, capture));
    await waitFor(() => expect(result.current.localModelControlAvailable).toBe(true));

    await act(async () => {
      await result.current.onScanLocalModels?.();
    });

    expect(test.scan).toHaveBeenCalledTimes(1);
    expect(result.current.localModelScanState).toBe("idle");
    expect(result.current.localModels).toHaveLength(2);
  });

  it("keeps the previous inventory when a rescan fails", async () => {
    const test = harness();
    test.scan.mockRejectedValueOnce(new Error("scan failed"));
    const capture = voice();
    const { result } = renderHook(() => usePresentationController(test.host, capture));
    await waitFor(() => expect(result.current.localModelControlAvailable).toBe(true));
    const before = result.current.localModels;

    await act(async () => {
      await result.current.onScanLocalModels?.();
    });

    expect(result.current.localModelScanState).toBe("failed");
    expect(result.current.localModels).toEqual(before);
  });

  it("switches to one exact stable model and accepts only the backend canonical result", async () => {
    const test = harness();
    const capture = voice();
    const { result } = renderHook(() => usePresentationController(test.host, capture));
    await waitFor(() => expect(result.current.localModelControlAvailable).toBe(true));

    await act(async () => {
      await result.current.onLocalModelSelectionChange?.({
        mode: "manual-local",
        modelId: NOVA_ID,
      });
    });

    expect(test.select).toHaveBeenCalledWith({
      mode: "manual-local",
      modelId: NOVA_ID,
    });
    expect(result.current.localModelSelection).toEqual({
      mode: "manual-local",
      modelId: NOVA_ID,
    });
  });

  it("reads the concrete answering model after Nova emits response content", async () => {
    const test = harness();
    const capture = voice();
    const { result } = renderHook(() => usePresentationController(test.host, capture));
    await waitFor(() => expect(result.current.localModelControlAvailable).toBe(true));

    act(() => {
      test.getHandlers().onEvent({
        type: "message",
        message: {
          id: "nova-answer-1",
          author: "nova",
          text: "DOLPHIN ONLINE",
          createdAt: "2026-08-16T18:21:00+00:00",
        },
      });
    });

    await waitFor(() => expect(result.current.answeringModel).toEqual({
      modelId: DOLPHIN_ID,
      displayName: "Dolphin Mixtral 8x7B",
      engine: "ollama",
    }));
    expect(test.status).toHaveBeenCalled();
  });
});
