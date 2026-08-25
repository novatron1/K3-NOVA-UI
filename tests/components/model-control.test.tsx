import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelControl } from "../../src/components/ModelControl";
import type { LocalModelSummary } from "../../src/domain/local-models";

const DOLPHIN_ID = `local_${"a".repeat(64)}`;
const NOVA_ID = `local_${"b".repeat(64)}`;

const MODELS: readonly LocalModelSummary[] = Object.freeze([
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
]);

describe("ModelControl", () => {
  it("shows Auto first and all scanned usable local models", () => {
    render(
      <ModelControl
        models={MODELS}
        selection={{ mode: "auto-local", modelId: null }}
        scanState="idle"
        answeringModel={null}
        disabled={false}
        onScan={async () => undefined}
        onSelectionChange={async () => undefined}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Auto");
    expect(screen.getByRole("option", { name: /Dolphin Mixtral 8x7B/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Nova Trained 1.5B/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan Local Models" })).toBeEnabled();
  });

  it("sends only a stable public model id for manual selection", async () => {
    const onSelectionChange = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(
      <ModelControl
        models={MODELS}
        selection={{ mode: "auto-local", modelId: null }}
        scanState="idle"
        answeringModel={null}
        disabled={false}
        onScan={async () => undefined}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), DOLPHIN_ID);

    expect(onSelectionChange).toHaveBeenCalledWith({
      mode: "manual-local",
      modelId: DOLPHIN_ID,
    });
  });

  it("switches back to Auto and exposes scan progress and answering model", async () => {
    const onScan = vi.fn(async () => undefined);
    const onSelectionChange = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const { rerender } = render(
      <ModelControl
        models={MODELS}
        selection={{ mode: "manual-local", modelId: DOLPHIN_ID }}
        scanState="scanning"
        answeringModel={{
          modelId: DOLPHIN_ID,
          displayName: "Dolphin Mixtral 8x7B",
          engine: "ollama",
        }}
        disabled={false}
        onScan={onScan}
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
    expect(screen.getByText("Answering: Dolphin Mixtral 8x7B")).toBeInTheDocument();

    rerender(
      <ModelControl
        models={MODELS}
        selection={{ mode: "manual-local", modelId: DOLPHIN_ID }}
        scanState="idle"
        answeringModel={null}
        disabled={false}
        onScan={onScan}
        onSelectionChange={onSelectionChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Scan Local Models" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "auto-local");

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith({
      mode: "auto-local",
      modelId: null,
    });
  });

  it("keeps the last model list visible when a rescan fails", () => {
    render(
      <ModelControl
        models={MODELS}
        selection={{ mode: "auto-local", modelId: null }}
        scanState="failed"
        answeringModel={null}
        disabled={false}
        onScan={async () => undefined}
        onSelectionChange={async () => undefined}
      />,
    );

    expect(screen.getByRole("option", { name: /Dolphin Mixtral/i })).toBeInTheDocument();
    expect(screen.getByText("Scan failed. Keeping last known models.")).toBeInTheDocument();
  });
});
