export type LocalModelEngine = "ollama" | "llama.cpp" | "transformers";
export type LocalModelSource = "ollama" | "gguf" | "checkpoint";
export type LocalModelRuntimeState =
  | "stopped"
  | "starting"
  | "ready"
  | "busy"
  | "failed";

export interface LocalModelCapabilities {
  readonly text: boolean;
  readonly vision: boolean;
  readonly tools: boolean;
  readonly embeddings: boolean;
  readonly reasoning: boolean;
}

export interface LocalModelSummary {
  readonly modelId: string;
  readonly displayName: string;
  readonly engine: LocalModelEngine;
  readonly source: LocalModelSource;
  readonly sizeBytes: number | null;
  readonly parameterCount: number | null;
  readonly quantization: string | null;
  readonly contextLength: number | null;
  readonly capabilities: LocalModelCapabilities;
  readonly runtimeState: LocalModelRuntimeState;
  readonly failureCode: string | null;
}

export type LocalModelSelection =
  | Readonly<{ readonly mode: "auto-local"; readonly modelId: null }>
  | Readonly<{ readonly mode: "manual-local"; readonly modelId: string }>;

export interface LocalModelInventory {
  readonly version: number;
  readonly scannedAt: string;
  readonly selection: LocalModelSelection;
  readonly models: readonly LocalModelSummary[];
}

export interface AnsweringLocalModel {
  readonly modelId: string;
  readonly displayName: string;
  readonly engine: LocalModelEngine;
}

export interface LocalModelStatus {
  readonly selection: LocalModelSelection;
  readonly answeringModel: AnsweringLocalModel | null;
}

const MODEL_ID = /^local_[0-9a-f]{64}$/;
const MAX_MODELS = 256;
const MAX_DISPLAY_BYTES = 512;
const MAX_LABEL_BYTES = 256;

const MODEL_KEYS = Object.freeze([
  "modelId",
  "displayName",
  "engine",
  "source",
  "sizeBytes",
  "parameterCount",
  "quantization",
  "contextLength",
  "capabilities",
  "runtimeState",
  "failureCode",
] as const);
const CAPABILITY_KEYS = Object.freeze([
  "text",
  "vision",
  "tools",
  "embeddings",
  "reasoning",
] as const);
const INVENTORY_KEYS = Object.freeze([
  "version",
  "scannedAt",
  "selection",
  "models",
] as const);
const SELECTION_KEYS = Object.freeze(["mode", "modelId"] as const);
const STATUS_KEYS = Object.freeze(["selection", "answeringModel"] as const);
const ANSWERING_KEYS = Object.freeze(["modelId", "displayName", "engine"] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error("invalid local model payload");
  }
}

function boundedText(value: unknown, maxBytes: number): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || new TextEncoder().encode(value).length > maxBytes
  ) {
    throw new Error("invalid local model text");
  }
  return value;
}

function modelId(value: unknown): string {
  if (typeof value !== "string" || !MODEL_ID.test(value)) {
    throw new Error("invalid local model id");
  }
  return value;
}

function nullableNonnegativeInteger(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new Error("invalid local model integer");
  }
  return value;
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    throw new Error("invalid local model positive integer");
  }
  return value;
}

function nullableLabel(value: unknown): string | null {
  return value === null ? null : boundedText(value, MAX_LABEL_BYTES);
}

function engine(value: unknown): LocalModelEngine {
  if (value !== "ollama" && value !== "llama.cpp" && value !== "transformers") {
    throw new Error("invalid local model engine");
  }
  return value;
}

function source(value: unknown): LocalModelSource {
  if (value !== "ollama" && value !== "gguf" && value !== "checkpoint") {
    throw new Error("invalid local model source");
  }
  return value;
}

function runtimeState(value: unknown): LocalModelRuntimeState {
  if (
    value !== "stopped"
    && value !== "starting"
    && value !== "ready"
    && value !== "busy"
    && value !== "failed"
  ) {
    throw new Error("invalid local model runtime state");
  }
  return value;
}

function decodeCapabilities(value: unknown): LocalModelCapabilities {
  if (!isRecord(value)) {
    throw new Error("invalid local model capabilities");
  }
  assertExactKeys(value, CAPABILITY_KEYS);
  for (const key of CAPABILITY_KEYS) {
    if (typeof value[key] !== "boolean") {
      throw new Error("invalid local model capability");
    }
  }
  return Object.freeze({
    text: value.text as boolean,
    vision: value.vision as boolean,
    tools: value.tools as boolean,
    embeddings: value.embeddings as boolean,
    reasoning: value.reasoning as boolean,
  });
}

function decodeSelection(value: unknown): LocalModelSelection {
  if (!isRecord(value)) {
    throw new Error("invalid local model selection");
  }
  assertExactKeys(value, SELECTION_KEYS);
  if (value.mode === "auto-local" && value.modelId === null) {
    return Object.freeze({ mode: "auto-local", modelId: null });
  }
  if (value.mode === "manual-local") {
    return Object.freeze({ mode: "manual-local", modelId: modelId(value.modelId) });
  }
  throw new Error("invalid local model selection");
}

function decodeModel(value: unknown): LocalModelSummary {
  if (!isRecord(value)) {
    throw new Error("invalid local model row");
  }
  assertExactKeys(value, MODEL_KEYS);
  return Object.freeze({
    modelId: modelId(value.modelId),
    displayName: boundedText(value.displayName, MAX_DISPLAY_BYTES),
    engine: engine(value.engine),
    source: source(value.source),
    sizeBytes: nullableNonnegativeInteger(value.sizeBytes),
    parameterCount: nullableNonnegativeInteger(value.parameterCount),
    quantization: nullableLabel(value.quantization),
    contextLength: nullablePositiveInteger(value.contextLength),
    capabilities: decodeCapabilities(value.capabilities),
    runtimeState: runtimeState(value.runtimeState),
    failureCode: nullableLabel(value.failureCode),
  });
}

export function decodeLocalModelInventory(value: unknown): LocalModelInventory {
  if (!isRecord(value)) {
    throw new Error("invalid local model inventory");
  }
  assertExactKeys(value, INVENTORY_KEYS);
  if (
    typeof value.version !== "number"
    || !Number.isSafeInteger(value.version)
    || value.version < 0
    || typeof value.scannedAt !== "string"
    || value.scannedAt.length === 0
    || !Number.isFinite(Date.parse(value.scannedAt))
    || !Array.isArray(value.models)
    || value.models.length > MAX_MODELS
  ) {
    throw new Error("invalid local model inventory");
  }
  return Object.freeze({
    version: value.version,
    scannedAt: value.scannedAt,
    selection: decodeSelection(value.selection),
    models: Object.freeze(value.models.map(decodeModel)),
  });
}

function decodeAnsweringModel(value: unknown): AnsweringLocalModel | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("invalid answering local model");
  }
  assertExactKeys(value, ANSWERING_KEYS);
  return Object.freeze({
    modelId: modelId(value.modelId),
    displayName: boundedText(value.displayName, MAX_DISPLAY_BYTES),
    engine: engine(value.engine),
  });
}

export function decodeLocalModelStatus(value: unknown): LocalModelStatus {
  if (!isRecord(value)) {
    throw new Error("invalid local model status");
  }
  assertExactKeys(value, STATUS_KEYS);
  return Object.freeze({
    selection: decodeSelection(value.selection),
    answeringModel: decodeAnsweringModel(value.answeringModel),
  });
}
