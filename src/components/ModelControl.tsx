import type {
  AnsweringLocalModel,
  LocalModelSelection,
  LocalModelSummary,
} from "../domain/local-models";
import styles from "./ModelControl.module.css";

export interface ModelControlProps {
  readonly models: readonly LocalModelSummary[];
  readonly selection: LocalModelSelection;
  readonly scanState: "idle" | "scanning" | "failed";
  readonly answeringModel: AnsweringLocalModel | null;
  readonly disabled: boolean;
  readonly onScan: () => Promise<void>;
  readonly onSelectionChange: (
    selection: LocalModelSelection,
  ) => Promise<void>;
}

const AUTO_VALUE = "auto-local";

function selectedValue(selection: LocalModelSelection): string {
  return selection.mode === "manual-local" ? selection.modelId : AUTO_VALUE;
}

export function ModelControl({
  models,
  selection,
  scanState,
  answeringModel,
  disabled,
  onScan,
  onSelectionChange,
}: ModelControlProps) {
  const handleSelection = (value: string): void => {
    if (value === AUTO_VALUE) {
      void onSelectionChange(Object.freeze({
        mode: "auto-local",
        modelId: null,
      }));
      return;
    }

    const selected = models.find((model) => model.modelId === value);
    if (selected === undefined || selected.runtimeState === "failed") {
      return;
    }
    void onSelectionChange(Object.freeze({
      mode: "manual-local",
      modelId: selected.modelId,
    }));
  };

  return (
    <section className={styles.root} aria-label="Local models">
      <label className={styles.selector}>
        <span className={styles.label}>Model</span>
        <select
          aria-label="Model"
          className={styles.select}
          value={selectedValue(selection)}
          disabled={disabled}
          onChange={(event) => handleSelection(event.currentTarget.value)}
        >
          <option value={AUTO_VALUE}>Auto</option>
          {models.map((model) => (
            <option
              key={model.modelId}
              value={model.modelId}
              disabled={model.runtimeState === "failed"}
            >
              {model.displayName} · {model.engine} · {model.runtimeState}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={styles.scanButton}
        disabled={disabled || scanState === "scanning"}
        onClick={() => void onScan()}
      >
        {scanState === "scanning" ? "Scanning…" : "Scan Local Models"}
      </button>

      {answeringModel === null
        ? null
        : (
            <p className={styles.answering}>
              Answering: {answeringModel.displayName}
            </p>
          )}

      {scanState === "failed"
        ? (
            <p className={styles.failure} role="status">
              Scan failed. Keeping last known models.
            </p>
          )
        : null}
    </section>
  );
}
