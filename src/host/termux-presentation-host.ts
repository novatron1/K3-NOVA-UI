import type {
  AnsweringLocalModel,
  LocalModelInventory,
  LocalModelSelection,
  LocalModelStatus,
  LocalModelSummary,
} from "../domain/local-models";
import type { HostPresentationEvent } from "../domain/presentation-events";
import type {
  SanitizedHostSnapshot,
  TrustedPermissionGate,
} from "../domain/presentation-types";
import { validateHostEvent } from "../security/validate-host-event";
import type {
  LocalModelPresentationSession,
  PresentationHostAdapter,
  PresentationHostHandlers,
} from "./presentation-host";

type FetchImplementation = typeof fetch;

interface RawModelProfile {
  readonly id: string;
  readonly displayName: string;
  readonly filePath: string;
  readonly contextSize: number;
  readonly threads: number;
  readonly batchSize: number;
  readonly temperature: number;
  readonly topP: number;
  readonly topK: number;
  readonly repeatPenalty: number;
  readonly maxOutputTokens: number;
  readonly chatTemplateOverride: string | null;
  readonly selected: boolean;
  readonly sizeBytes: number | null;
}

interface RawStatus {
  readonly modelReady: boolean;
  readonly memoryCount: number;
  readonly selectedModel: RawModelProfile | null;
}

interface StoredModel {
  readonly modelId: string;
  readonly profile: RawModelProfile;
}

class HostUnavailableError extends Error {
  constructor() {
    super("Termux Nova backend unavailable");
  }
}

class InvalidBackendPayloadError extends Error {
  constructor() {
    super("invalid Termux Nova backend payload");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0
    ? value
    : fallback;
}

function profileFromUnknown(
  value: unknown,
  selectedFallback = false,
): RawModelProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const displayName = asString(value.display_name);
  const filePath = asString(value.file_path);
  if (id === null || displayName === null || filePath === null) {
    return null;
  }
  return Object.freeze({
    id,
    displayName,
    filePath,
    contextSize: asPositiveInteger(value.context_size, 8192),
    threads: asPositiveInteger(value.threads, 4),
    batchSize: asPositiveInteger(value.batch_size, 256),
    temperature: asFiniteNumber(value.temperature, 0.7),
    topP: asFiniteNumber(value.top_p, 0.95),
    topK: asPositiveInteger(value.top_k, 40),
    repeatPenalty: asFiniteNumber(value.repeat_penalty, 1.05),
    maxOutputTokens: asPositiveInteger(value.max_output_tokens, 512),
    chatTemplateOverride: value.chat_template_override === null
      ? null
      : asString(value.chat_template_override),
    selected: typeof value.selected === "boolean"
      ? value.selected
      : selectedFallback,
    sizeBytes: typeof value.size_bytes === "number"
      && Number.isSafeInteger(value.size_bytes)
      && value.size_bytes >= 0
      ? value.size_bytes
      : null,
  });
}

function statusFromUnknown(value: unknown): RawStatus {
  if (!isRecord(value) || value.ok !== true) {
    throw new InvalidBackendPayloadError();
  }
  const selectedModel = value.selected_model === null
    ? null
    : profileFromUnknown(value.selected_model, true);
  if (value.selected_model !== null && selectedModel === null) {
    throw new InvalidBackendPayloadError();
  }
  return Object.freeze({
    modelReady: value.model_ready === true,
    memoryCount: typeof value.memory_count === "number"
      && Number.isSafeInteger(value.memory_count)
      && value.memory_count >= 0
      ? value.memory_count
      : 0,
    selectedModel,
  });
}

function stableLocalModelId(seed: string): string {
  const hexSeed = seed.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (hexSeed.length >= 32) {
    const normalized = hexSeed.slice(0, 32);
    return `local_${normalized}${normalized}`;
  }

  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    for (let slot = 0; slot < words.length; slot += 1) {
      const current = words[slot] ?? 0;
      const mixed = Math.imul(current ^ code ^ (index + slot), 0x01000193);
      words[slot] = mixed >>> 0;
    }
  }
  const block = words.map((word) => word.toString(16).padStart(8, "0")).join("");
  return `local_${block}${block}`;
}

function quantizationFromName(name: string): string | null {
  return name.match(/(?:^|[-_.])(Q\d(?:_[A-Z0-9]+)+)(?:$|[-_.])/i)?.[1]?.toUpperCase()
    ?? null;
}

function authorizationHeaders(
  token: string,
  hasBody = false,
  accept = "application/json",
): Readonly<Record<string, string>> {
  return Object.freeze({
    accept,
    authorization: `Bearer ${token}`,
    ...(hasBody ? { "content-type": "application/json" } : {}),
  });
}

async function decodeResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new HostUnavailableError();
  }
  try {
    return await response.json() as unknown;
  } catch {
    throw new InvalidBackendPayloadError();
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function toolGate(value: unknown): TrustedPermissionGate | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asString(value.id);
  const argv = Array.isArray(value.argv)
    ? value.argv.filter((entry): entry is string => typeof entry === "string")
    : [];
  if (id === null || argv.length === 0) {
    return null;
  }
  const executable = argv[0] ?? "Termux command";
  return Object.freeze({
    approvalRequestId: id,
    kind: "permission",
    actionLabel: `Run ${executable}`,
    canonicalResource: "Nova Termux workspace",
    policyLabels: Object.freeze(["Local command", "Explicit approval"]),
    reasonLabels: Object.freeze(["Nova requested a Termux tool"]),
    requiredPermission: "User approval",
    actualPermission: "Pending",
    irreversible: true,
    choices: Object.freeze(["approve", "deny", "cancel"] as const),
  });
}

class TermuxPresentationSession implements LocalModelPresentationSession {
  private readonly runId = `termux-${Date.now().toString(36)}`;
  private readonly conversationId = `k3-${Date.now().toString(36)}`;
  private readonly models = new Map<string, RawModelProfile>();
  private inventoryVersion = 0;
  private closed = false;
  private activeStream: AbortController | null = null;
  private status: RawStatus;
  private pendingGate: TrustedPermissionGate | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchImplementation,
    private readonly handlers: PresentationHostHandlers,
    private readonly signal: AbortSignal,
    initialStatus: RawStatus,
  ) {
    this.status = initialStatus;
  }

  initialize(): void {
    this.emitSnapshot(
      this.status.modelReady ? "idle" : "paused",
      this.status.modelReady ? "Ready for a message" : "Local model is not ready",
    );
  }

  private emit(event: HostPresentationEvent): void {
    if (this.closed || this.signal.aborted) {
      return;
    }
    const validation = validateHostEvent(event);
    if (!validation.ok) {
      this.failFatal("invalid_event");
      return;
    }
    this.handlers.onEvent(validation.event);
  }

  private failFatal(code: "invalid_event" | "host_unavailable"): void {
    if (this.closed || this.signal.aborted) {
      return;
    }
    this.closed = true;
    this.activeStream?.abort();
    this.handlers.onFatalError(code);
  }

  private snapshot(
    phase: SanitizedHostSnapshot["phase"],
    statusLabel: string,
    budgetSummary: readonly string[] = Object.freeze([]),
  ): SanitizedHostSnapshot {
    const selected = this.status.selectedModel;
    const gate = phase === "approval_required" ? this.pendingGate : null;
    return Object.freeze({
      schemaVersion: 1,
      runId: this.runId,
      phase,
      trustTone: gate === null ? "trusted_local" : "approval_required",
      statusLabel,
      providerLabel: "Termux · llama.cpp",
      modelLabel: selected?.displayName ?? "Local GGUF",
      privacyClass: "private",
      cloudConsentRequired: false,
      cloudConsentGranted: false,
      isolation: "degraded",
      isolationLabel: "On-device Termux process",
      contractSummary: Object.freeze([
        "Loopback-only Nova backend",
        "Bearer-authenticated local session",
      ]),
      permissionSummary: Object.freeze([
        "Termux tools are policy-gated",
        "External effects require approval when requested",
      ]),
      ledgerSummary: Object.freeze([
        `Persistent memories: ${this.status.memoryCount}`,
      ]),
      evidence: "not_requested",
      evidenceLabel: "Not requested",
      budgetSummary: Object.freeze([...budgetSummary]),
      observerSummary: Object.freeze([
        "Nova context and long-term memory routing active",
      ]),
      rollback: "not_required",
      rollbackLabel: "Not required",
      permissionGate: gate,
    });
  }

  private emitSnapshot(
    phase: SanitizedHostSnapshot["phase"],
    label: string,
    budgetSummary?: readonly string[],
  ): void {
    this.emit({
      type: "snapshot",
      snapshot: this.snapshot(phase, label, budgetSummary),
    });
  }

  private async request(
    path: string,
    method: "GET" | "POST" = "GET",
    body: Readonly<Record<string, unknown>> | null = null,
    signal: AbortSignal = this.signal,
  ): Promise<unknown> {
    if (this.closed || signal.aborted) {
      throw new HostUnavailableError();
    }
    const init: RequestInit = {
      method,
      headers: authorizationHeaders(this.token, body !== null),
      signal,
    };
    if (body !== null) {
      init.body = JSON.stringify(body);
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    return decodeResponse(response);
  }

  private async refreshStatus(): Promise<RawStatus> {
    this.status = statusFromUnknown(await this.request("/status"));
    return this.status;
  }

  private registerProfiles(values: readonly unknown[]): readonly StoredModel[] {
    const stored: StoredModel[] = [];
    this.models.clear();
    for (const value of values.slice(0, 256)) {
      const profile = profileFromUnknown(value);
      if (profile === null) {
        continue;
      }
      const modelId = stableLocalModelId(profile.id);
      this.models.set(modelId, profile);
      stored.push(Object.freeze({ modelId, profile }));
    }
    return Object.freeze(stored);
  }

  private localSelection(): LocalModelSelection {
    const selected = this.status.selectedModel;
    if (selected === null) {
      return Object.freeze({ mode: "auto-local", modelId: null });
    }
    return Object.freeze({
      mode: "manual-local",
      modelId: stableLocalModelId(selected.id),
    });
  }

  private summary(model: StoredModel): LocalModelSummary {
    const selected = this.status.selectedModel?.id === model.profile.id;
    return Object.freeze({
      modelId: model.modelId,
      displayName: model.profile.displayName,
      engine: "llama.cpp",
      source: "gguf",
      sizeBytes: model.profile.sizeBytes,
      parameterCount: null,
      quantization: quantizationFromName(model.profile.displayName),
      contextLength: model.profile.contextSize,
      capabilities: Object.freeze({
        text: true,
        vision: false,
        tools: true,
        embeddings: false,
        reasoning: false,
      }),
      runtimeState: selected
        ? (this.status.modelReady ? "ready" : "starting")
        : "stopped",
      failureCode: null,
    });
  }

  readonly getLocalModels = async (): Promise<LocalModelInventory> => {
    try {
      await this.refreshStatus();
    } catch {
      // Keep the last authenticated status from connect(). Model inventory is
      // optional UI metadata and must never take down an otherwise usable chat.
    }

    let rawModels: readonly unknown[] = [];
    try {
      const candidate = await this.request("/models");
      if (Array.isArray(candidate)) {
        rawModels = candidate;
      }
    } catch {
      // Fall back to the selected model already returned by /status.
    }

    let stored: readonly StoredModel[];
    if (rawModels.length === 0 && this.status.selectedModel !== null) {
      const profile = this.status.selectedModel;
      const modelId = stableLocalModelId(profile.id);
      this.models.clear();
      this.models.set(modelId, profile);
      stored = Object.freeze([
        Object.freeze({ modelId, profile }),
      ]);
    } else {
      stored = this.registerProfiles(rawModels);
    }

    this.inventoryVersion += 1;
    return Object.freeze({
      version: this.inventoryVersion,
      scannedAt: nowIso(),
      selection: this.localSelection(),
      models: Object.freeze(stored.map((model) => this.summary(model))),
    });
  };

  readonly scanLocalModels = async (): Promise<LocalModelInventory> => {
    const discovered = await this.request("/models/discover");
    if (!Array.isArray(discovered)) {
      throw new InvalidBackendPayloadError();
    }

    const profiles = await this.request("/models");
    if (!Array.isArray(profiles)) {
      throw new InvalidBackendPayloadError();
    }

    const merged: unknown[] = [...profiles];
    const knownPaths = new Set(
      profiles
        .map((value) => profileFromUnknown(value)?.filePath)
        .filter((value): value is string => value !== undefined && value !== null),
    );

    for (const value of discovered) {
      if (!isRecord(value)) {
        continue;
      }
      const filePath = asString(value.file_path);
      const displayName = asString(value.display_name);
      if (filePath === null || displayName === null || knownPaths.has(filePath)) {
        continue;
      }
      merged.push({
        id: `discovered-${stableLocalModelId(filePath).slice(6, 38)}`,
        display_name: displayName,
        file_path: filePath,
        context_size: 8192,
        threads: 6,
        batch_size: 256,
        temperature: 0.7,
        top_p: 0.95,
        top_k: 40,
        repeat_penalty: 1.05,
        max_output_tokens: 512,
        chat_template_override: null,
        selected: false,
        size_bytes: value.size_bytes,
      });
    }

    await this.refreshStatus();
    const stored = this.registerProfiles(merged);
    this.inventoryVersion += 1;
    return Object.freeze({
      version: this.inventoryVersion,
      scannedAt: nowIso(),
      selection: this.localSelection(),
      models: Object.freeze(stored.map((model) => this.summary(model))),
    });
  };

  readonly setLocalModelSelection = async (
    selection: LocalModelSelection,
  ): Promise<LocalModelInventory> => {
    if (selection.mode === "auto-local") {
      return this.getLocalModels();
    }

    const profile = this.models.get(selection.modelId);
    if (profile === undefined) {
      throw new InvalidBackendPayloadError();
    }

    if (
      this.status.selectedModel !== null
      && this.status.selectedModel.id !== profile.id
      && this.status.modelReady
    ) {
      await this.request("/backend/stop-model", "POST", Object.freeze({}));
    }

    await this.request("/models/select", "POST", Object.freeze({
      id: profile.id.startsWith("discovered-") ? undefined : profile.id,
      display_name: profile.displayName,
      file_path: profile.filePath,
      context_size: profile.contextSize,
      threads: profile.threads,
      batch_size: profile.batchSize,
      temperature: profile.temperature,
      top_p: profile.topP,
      top_k: profile.topK,
      repeat_penalty: profile.repeatPenalty,
      max_output_tokens: profile.maxOutputTokens,
      chat_template_override: profile.chatTemplateOverride,
    }));
    await this.request("/backend/start-model", "POST", Object.freeze({}));
    await this.refreshStatus();
    return this.getLocalModels();
  };

  readonly getLocalModelStatus = async (): Promise<LocalModelStatus> => {
    await this.refreshStatus();
    const selection = this.localSelection();
    const selected = this.status.selectedModel;
    let answeringModel: AnsweringLocalModel | null = null;
    if (this.status.modelReady && selected !== null) {
      answeringModel = Object.freeze({
        modelId: stableLocalModelId(selected.id),
        displayName: selected.displayName,
        engine: "llama.cpp",
      });
    }
    return Object.freeze({ selection, answeringModel });
  };

  private async consumeChatStream(
    response: Response,
    requestId: string,
    streamSignal: AbortSignal,
  ): Promise<void> {
    if (!response.ok || response.body === null) {
      throw new HostUnavailableError();
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("text/event-stream")) {
      throw new InvalidBackendPayloadError();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let novaText = "";
    let novaMessageId: string | null = null;
    let completed = false;

    const processEvent = (candidate: unknown): void => {
      if (!isRecord(candidate) || typeof candidate.type !== "string") {
        throw new InvalidBackendPayloadError();
      }

      if (candidate.type === "start") {
        const budgets = isRecord(candidate.context)
          && isRecord(candidate.context.budgets)
          ? Object.entries(candidate.context.budgets)
              .filter((entry): entry is [string, number] => typeof entry[1] === "number")
              .map(([key, value]) => `${key}: ${value} tokens`)
          : [];
        this.emitSnapshot("responding", "Nova is responding", budgets);
        return;
      }

      if (candidate.type === "token") {
        const token = typeof candidate.token === "string" ? candidate.token : null;
        if (token === null) {
          throw new InvalidBackendPayloadError();
        }
        novaText += token;
        if (novaMessageId === null) {
          novaMessageId = `nova-${requestId}`;
          this.emit({
            type: "message",
            message: Object.freeze({
              id: novaMessageId,
              author: "nova",
              text: token,
              createdAt: nowIso(),
            }),
          });
        } else {
          this.emit({
            type: "message_replaced",
            messageId: novaMessageId,
            text: novaText,
          });
        }
        return;
      }

      if (candidate.type === "tool_pending") {
        const gate = toolGate(candidate.tool);
        if (gate !== null) {
          this.pendingGate = gate;
          this.emitSnapshot(
            "approval_required",
            "A Termux action needs your approval",
          );
        }
        return;
      }

      if (candidate.type === "done") {
        const finalText = typeof candidate.text === "string" ? candidate.text : novaText;
        if (novaMessageId === null && finalText.length > 0) {
          novaMessageId = `nova-${requestId}`;
          novaText = finalText;
          this.emit({
            type: "message",
            message: Object.freeze({
              id: novaMessageId,
              author: "nova",
              text: finalText,
              createdAt: nowIso(),
            }),
          });
        } else if (novaMessageId !== null && finalText !== novaText) {
          novaText = finalText;
          this.emit({
            type: "message_replaced",
            messageId: novaMessageId,
            text: finalText,
          });
        }
        completed = true;
        if (this.pendingGate === null) {
          this.emitSnapshot("idle", "Ready for a message");
        }
        return;
      }

      if (candidate.type === "error") {
        throw new HostUnavailableError();
      }
    };

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        return;
      }
      const jsonText = trimmed.slice(5).trim();
      if (jsonText.length === 0) {
        return;
      }
      try {
        processEvent(JSON.parse(jsonText) as unknown);
      } catch (error: unknown) {
        if (
          error instanceof HostUnavailableError
          || error instanceof InvalidBackendPayloadError
        ) {
          throw error;
        }
        throw new InvalidBackendPayloadError();
      }
    };

    try {
      while (!streamSignal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        pending += decoder.decode(value, { stream: true });
        while (true) {
          const separator = pending.indexOf("\n");
          if (separator < 0) {
            break;
          }
          const line = pending.slice(0, separator);
          pending = pending.slice(separator + 1);
          processLine(line);
        }
      }
      pending += decoder.decode();
      for (const line of pending.split("\n")) {
        processLine(line);
      }
      if (!streamSignal.aborted && !completed && this.pendingGate === null) {
        throw new HostUnavailableError();
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Stream cleanup is best-effort.
      }
    }
  }

  readonly submitText = async (text: string): Promise<void> => {
    const message = text.trim();
    if (message.length === 0 || this.closed || this.signal.aborted) {
      return;
    }

    this.emit({
      type: "message",
      message: Object.freeze({
        id: `user-${Date.now().toString(36)}`,
        author: "user",
        text: message,
        createdAt: nowIso(),
      }),
    });
    this.emitSnapshot("processing", "Nova is thinking");

    const started = await this.request("/chat", "POST", Object.freeze({
      conversation_id: this.conversationId,
      message,
    }));
    if (!isRecord(started) || asString(started.request_id) === null) {
      throw new InvalidBackendPayloadError();
    }
    const requestId = started.request_id as string;

    const streamController = new AbortController();
    this.activeStream?.abort();
    this.activeStream = streamController;
    const abortForSession = (): void => streamController.abort();
    if (this.signal.aborted) {
      streamController.abort();
    } else {
      this.signal.addEventListener("abort", abortForSession, { once: true });
    }

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/chat/stream/${encodeURIComponent(requestId)}`,
        {
          method: "GET",
          headers: authorizationHeaders(
            this.token,
            false,
            "text/event-stream",
          ),
          signal: streamController.signal,
        },
      );
      await this.consumeChatStream(response, requestId, streamController.signal);
    } catch (error: unknown) {
      if (!streamController.signal.aborted && !this.signal.aborted) {
        this.failFatal(
          error instanceof InvalidBackendPayloadError
            ? "invalid_event"
            : "host_unavailable",
        );
        throw error instanceof Error ? error : new HostUnavailableError();
      }
    } finally {
      this.signal.removeEventListener("abort", abortForSession);
      if (this.activeStream === streamController) {
        this.activeStream = null;
      }
    }
  };

  readonly submitVoiceTranscript = (transcript: string): Promise<void> => (
    this.submitText(transcript)
  );

  readonly decidePermission = async (
    approvalRequestId: string,
    decision: "approve" | "deny" | "cancel",
  ): Promise<void> => {
    if (
      this.pendingGate === null
      || this.pendingGate.approvalRequestId !== approvalRequestId
    ) {
      return;
    }

    if (decision === "approve") {
      const result = await this.request(
        `/tools/${encodeURIComponent(approvalRequestId)}/approve`,
        "POST",
        Object.freeze({}),
      );
      if (isRecord(result)) {
        const state = asString(result.approval_state) ?? "completed";
        const stdout = typeof result.stdout === "string"
          ? result.stdout.trim().slice(-4000)
          : "";
        this.emit({
          type: "message",
          message: Object.freeze({
            id: `tool-${approvalRequestId}`,
            author: "nova",
            text: stdout.length > 0
              ? `Termux action ${state}:\n${stdout}`
              : `Termux action ${state}.`,
            createdAt: nowIso(),
          }),
        });
      }
    }

    this.pendingGate = null;
    this.emitSnapshot(
      "idle",
      decision === "approve"
        ? "Termux action finished"
        : "Termux action was not run",
    );
  };

  readonly cancel = async (): Promise<void> => {
    if (this.closed) {
      return;
    }
    this.activeStream?.abort();
    this.emit({ type: "session_closed", reason: "cancelled" });
    this.closed = true;
  };

  readonly close = async (): Promise<void> => {
    this.activeStream?.abort();
    this.closed = true;
  };
}

export class TermuxPresentationHost implements PresentationHostAdapter {
  constructor(
    private readonly baseUrl: string | null,
    private readonly sessionToken: string | null,
    private readonly fetchImpl: FetchImplementation = fetch,
  ) {}

  readonly connect = async (
    handlers: PresentationHostHandlers,
    signal: AbortSignal,
  ): Promise<LocalModelPresentationSession> => {
    if (
      this.baseUrl === null
      || this.sessionToken === null
      || this.sessionToken.trim().length === 0
      || signal.aborted
    ) {
      handlers.onFatalError("host_unavailable");
      throw new HostUnavailableError();
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/status`, {
        method: "GET",
        headers: authorizationHeaders(this.sessionToken),
        signal,
      });
      const status = statusFromUnknown(await decodeResponse(response));
      const session = new TermuxPresentationSession(
        this.baseUrl,
        this.sessionToken,
        this.fetchImpl,
        handlers,
        signal,
        status,
      );
      session.initialize();
      return session;
    } catch (error: unknown) {
      if (!signal.aborted) {
        handlers.onFatalError(
          error instanceof InvalidBackendPayloadError
            ? "invalid_event"
            : "host_unavailable",
        );
      }
      throw error instanceof Error ? error : new HostUnavailableError();
    }
  };
}
