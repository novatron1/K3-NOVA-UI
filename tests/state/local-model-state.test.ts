import { describe, expect, it } from "vitest";

import type { LocalModelInventory } from "../../src/domain/local-models";
import {
  createInitialPresentationState,
  presentationReducer,
} from "../../src/state/presentation-reducer";

const MODEL_ID = `local_${"a".repeat(64)}`;

function inventory(): LocalModelInventory {
  return Object.freeze({
    version: 1,
    scannedAt: "2026-08-16T18:20:00+00:00",
    selection: Object.freeze({ mode: "auto-local", modelId: null }),
    models: Object.freeze([
      Object.freeze({
        modelId: MODEL_ID,
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
    ]),
  });
}

describe("presentation local-model state", () => {
  it("starts with model controls unavailable until a compatible host inventory arrives", () => {
    const state = createInitialPresentationState();

    expect(state.localModelControlAvailable).toBe(false);
    expect(state.localModels).toEqual([]);
    expect(state.localModelSelection).toEqual({
      mode: "auto-local",
      modelId: null,
    });
    expect(state.localModelScanState).toBe("idle");
    expect(state.answeringModel).toBeNull();
  });

  it("publishes the canonical backend inventory and selection atomically", () => {
    const next = presentationReducer(createInitialPresentationState(), {
      type: "local_models_updated",
      inventory: inventory(),
    });

    expect(next.localModelControlAvailable).toBe(true);
    expect(next.localModels).toHaveLength(1);
    expect(next.localModels[0]?.modelId).toBe(MODEL_ID);
    expect(next.localModelSelection).toEqual({
      mode: "auto-local",
      modelId: null,
    });
    expect(next.localModelScanState).toBe("idle");
  });

  it("marks a scan failure without destroying the last known-good inventory", () => {
    const loaded = presentationReducer(createInitialPresentationState(), {
      type: "local_models_updated",
      inventory: inventory(),
    });
    const scanning = presentationReducer(loaded, {
      type: "local_model_scan_state_changed",
      value: "scanning",
    });
    const failed = presentationReducer(scanning, {
      type: "local_model_scan_state_changed",
      value: "failed",
    });

    expect(failed.localModelScanState).toBe("failed");
    expect(failed.localModels).toEqual(loaded.localModels);
    expect(failed.localModelSelection).toEqual(loaded.localModelSelection);
  });

  it("tracks the concrete answering model separately from Auto or Manual selection", () => {
    const loaded = presentationReducer(createInitialPresentationState(), {
      type: "local_models_updated",
      inventory: inventory(),
    });
    const answered = presentationReducer(loaded, {
      type: "answering_local_model_changed",
      value: Object.freeze({
        modelId: MODEL_ID,
        displayName: "Dolphin Mixtral 8x7B",
        engine: "ollama",
      }),
    });

    expect(answered.localModelSelection.mode).toBe("auto-local");
    expect(answered.answeringModel).toEqual({
      modelId: MODEL_ID,
      displayName: "Dolphin Mixtral 8x7B",
      engine: "ollama",
    });
  });
});
