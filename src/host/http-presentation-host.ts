import {
  decodeLocalModelInventory,
  decodeLocalModelStatus,
  type LocalModelInventory,
  type LocalModelSelection,
  type LocalModelStatus,
} from "../domain/local-models";
import type { HostPresentationEvent } from "../domain/presentation-events";
import { validateHostEvent } from "../security/validate-host-event";
import type {
  LocalModelPresentationSession,
  PresentationHostAdapter,
  PresentationHostHandlers,
} from "./presentation-host";

const NDJSON_MEDIA_TYPE = "application/x-ndjson";
const TABLET_PROTOCOL_VERSION = "tablet-v1";

class HostUnavailableError extends Error {
  constructor() {
    super("presentation host unavailable");
  }
}

class InvalidPresentationEventError extends Error {
  constructor() {
    super("invalid presentation event");
  }
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authorizationHeaders(
  sessionToken: string,
  accept: string,
  hasBody = false,
): Readonly<Record<string, string>> {
  return Object.freeze({
    accept,
    authorization: `Bearer ${sessionToken}`,
    ...(hasBody ? { "content-type": "application/json" } : {}),
  });
}

async function decodeJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || response.status === 204) {
    throw new HostUnavailableError();
  }
  try {
    const value: unknown = await response.json();
    if (!isRecord(value)) {
      throw new HostUnavailableError();
    }
    return value;
  } catch (error: unknown) {
    if (error instanceof HostUnavailableError) {
      throw error;
    }
    throw new HostUnavailableError();
  }
}

function validatedUiEvent(candidate: unknown): HostPresentationEvent {
  const validation = validateHostEvent(candidate);
  if (!validation.ok) {
    throw new InvalidPresentationEventError();
  }
  return validation.event;
}

function snapshotEvent(payload: Record<string, unknown>): HostPresentationEvent {
  return validatedUiEvent({
    type: "snapshot",
    snapshot: {
      schemaVersion: payload.schemaVersion,
      runId: payload.runId,
      phase: payload.phase,
      trustTone: payload.trustTone,
      statusLabel: payload.statusLabel,
      providerLabel: payload.providerLabel,
      modelLabel: payload.modelLabel,
      privacyClass: payload.privacyClass,
      cloudConsentRequired: payload.cloudConsentRequired,
      cloudConsentGranted: payload.cloudConsentGranted,
      isolation: payload.isolation,
      isolationLabel: payload.isolationLabel,
      contractSummary: payload.contractSummary,
      permissionSummary: payload.permissionSummary,
      ledgerSummary: payload.ledgerSummary,
      evidence: payload.evidence,
      evidenceLabel: payload.evidenceLabel,
      budgetSummary: payload.budgetSummary,
      observerSummary: payload.observerSummary,
      rollback: payload.rollback,
      rollbackLabel: payload.rollbackLabel,
      permissionGate: payload.permissionGate,
    },
  });
}

function messageEvent(
  payload: Record<string, unknown>,
  messageBuffers: Map<string, string>,
): HostPresentationEvent {
  const messageId = payload.messageId;
  const role = payload.role;
  const text = payload.text;
  const timestamp = payload.timestamp;
  if (
    typeof messageId !== "string"
    || (role !== "user" && role !== "nova")
    || typeof text !== "string"
    || typeof timestamp !== "string"
  ) {
    throw new InvalidPresentationEventError();
  }

  const previous = messageBuffers.get(messageId);
  if (previous === undefined) {
    messageBuffers.set(messageId, text);
    return validatedUiEvent({
      type: "message",
      message: {
        id: messageId,
        author: role,
        text,
        createdAt: timestamp,
      },
    });
  }

  const cumulative = `${previous}${text}`;
  messageBuffers.set(messageId, cumulative);
  return validatedUiEvent({
    type: "message_replaced",
    messageId,
    text: cumulative,
  });
}

function convertedWireEvent(
  candidate: unknown,
  messageBuffers: Map<string, string>,
): HostPresentationEvent | null {
  if (!isRecord(candidate) || typeof candidate.kind !== "string" || !isRecord(candidate.payload)) {
    throw new InvalidPresentationEventError();
  }
  const { kind, payload } = candidate;

  switch (kind) {
    case "snapshot":
      return snapshotEvent(payload);
    case "message":
      return messageEvent(payload, messageBuffers);
    case "message_replaced": {
      const messageId = payload.messageId;
      const state = payload.state;
      if (typeof messageId !== "string" || typeof state !== "string") {
        throw new InvalidPresentationEventError();
      }
      if (state === "complete") {
        return null;
      }
      if (state !== "cancelled" && state !== "denied") {
        throw new InvalidPresentationEventError();
      }
      messageBuffers.set(messageId, state);
      return validatedUiEvent({ type: "message_replaced", messageId, text: state });
    }
    case "session_error": {
      if (typeof payload.label !== "string") {
        throw new InvalidPresentationEventError();
      }
      const rawCode = payload.code;
      const code = rawCode === "timeout"
        || rawCode === "disconnected"
        || rawCode === "invalid_event"
        || rawCode === "host_unavailable"
        ? rawCode
        : "host_unavailable";
      return validatedUiEvent({ type: "session_error", code, label: payload.label });
    }
    case "session_closed": {
      const rawReason = payload.reason;
      const reason = rawReason === "completed"
        || rawReason === "cancelled"
        || rawReason === "failed"
        ? rawReason
        : "failed";
      return validatedUiEvent({ type: "session_closed", reason });
    }
    default:
      throw new InvalidPresentationEventError();
  }
}

async function consumeEventStream(
  response: Response,
  handlers: PresentationHostHandlers,
  signal: AbortSignal,
): Promise<void> {
  if (!response.ok || response.body === null) {
    throw new HostUnavailableError();
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith(NDJSON_MEDIA_TYPE)) {
    throw new HostUnavailableError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const messageBuffers = new Map<string, string>();
  let pending = "";
  let terminalSeen = false;

  const processLine = (rawLine: string): void => {
    const line = rawLine.trim();
    if (line.length === 0) {
      return;
    }
    let wireValue: unknown;
    try {
      wireValue = JSON.parse(line) as unknown;
    } catch {
      throw new InvalidPresentationEventError();
    }
    const event = convertedWireEvent(wireValue, messageBuffers);
    if (event === null) {
      return;
    }
    if (event.type === "session_closed") {
      terminalSeen = true;
    }
    handlers.onEvent(event);
  };

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      pending += decoder.decode(value, { stream: true });
      while (true) {
        const lineEnd = pending.indexOf("\n");
        if (lineEnd < 0) {
          break;
        }
        const line = pending.slice(0, lineEnd);
        pending = pending.slice(lineEnd + 1);
        processLine(line);
      }
    }
    pending += decoder.decode();
    if (!signal.aborted && pending.trim().length > 0) {
      processLine(pending);
    }
    if (!signal.aborted && !terminalSeen) {
      throw new HostUnavailableError();
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Best-effort stream cleanup must not expose network details.
    }
  }
}

export class HttpPresentationHost implements PresentationHostAdapter {
  constructor(
    private readonly baseUrl: string | null,
    private readonly sessionToken: string | null,
    private readonly fetchImpl: FetchImplementation = fetch,
  ) {}

  async connect(
    handlers: PresentationHostHandlers,
    signal: AbortSignal,
  ): Promise<LocalModelPresentationSession> {
    let fatalSent = false;
    const failFatal = (code: "invalid_event" | "host_unavailable"): void => {
      if (fatalSent || signal.aborted) {
        return;
      }
      fatalSent = true;
      handlers.onFatalError(code);
    };
    const classifyFailure = (error: unknown): never => {
      failFatal(
        error instanceof InvalidPresentationEventError
          ? "invalid_event"
          : "host_unavailable",
      );
      throw error instanceof Error ? error : new HostUnavailableError();
    };

    if (this.baseUrl === null || this.sessionToken === null) {
      return classifyFailure(new HostUnavailableError());
    }

    const token = this.sessionToken;
    let sessionIdValue: string;
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/presentation/sessions`,
        {
          method: "POST",
          headers: authorizationHeaders(token, "application/json"),
          signal,
        },
      );
      const envelope = await decodeJson(response);
      const sessionId = envelope.sessionId;
      const protocolVersion = envelope.protocolVersion;
      if (
        typeof sessionId !== "string"
        || sessionId.length === 0
        || sessionId.length > 512
        || protocolVersion !== TABLET_PROTOCOL_VERSION
      ) {
        throw new HostUnavailableError();
      }
      sessionIdValue = sessionId;
    } catch (error: unknown) {
      return classifyFailure(error);
    }

    const encodedSessionId = encodeURIComponent(sessionIdValue);
    const sessionRoot = `${this.baseUrl}/v1/presentation/sessions/${encodedSessionId}`;
    const streamController = new AbortController();
    const abortStream = (): void => streamController.abort();
    if (signal.aborted) {
      abortStream();
    } else {
      signal.addEventListener("abort", abortStream, { once: true });
    }

    void this.fetchImpl(`${sessionRoot}/events`, {
      method: "GET",
      headers: authorizationHeaders(token, NDJSON_MEDIA_TYPE),
      signal: streamController.signal,
    }).then(
      (response) => consumeEventStream(response, handlers, streamController.signal),
      (error: unknown) => Promise.reject(error),
    ).catch((error: unknown) => {
      if (streamController.signal.aborted || signal.aborted) {
        return;
      }
      failFatal(
        error instanceof InvalidPresentationEventError
          ? "invalid_event"
          : "host_unavailable",
      );
    });

    let closed = false;
    const request = async (
      path: string,
      method: "POST" | "DELETE",
      body: Readonly<Record<string, string>> | null,
      lifecycleBound: boolean,
    ): Promise<void> => {
      if (closed && method !== "DELETE") {
        return;
      }
      try {
        const init: RequestInit = {
          method,
          headers: authorizationHeaders(token, "application/json", body !== null),
        };
        if (body !== null) {
          init.body = JSON.stringify(body);
        }
        if (lifecycleBound) {
          init.signal = signal;
        }
        const response = await this.fetchImpl(`${sessionRoot}${path}`, init);
        if (!response.ok) {
          throw new HostUnavailableError();
        }
      } catch (error: unknown) {
        if (lifecycleBound && !signal.aborted) {
          failFatal("host_unavailable");
        }
        throw error instanceof Error ? error : new HostUnavailableError();
      }
    };

    const modelRequest = async (
      path: string,
      method: "GET" | "POST",
      body: Readonly<Record<string, unknown>> | null,
    ): Promise<Record<string, unknown>> => {
      if (closed || signal.aborted) {
        throw new HostUnavailableError();
      }
      try {
        const init: RequestInit = {
          method,
          headers: authorizationHeaders(token, "application/json", body !== null),
          signal,
        };
        if (body !== null) {
          init.body = JSON.stringify(body);
        }
        const response = await this.fetchImpl(`${sessionRoot}${path}`, init);
        return await decodeJson(response);
      } catch (error: unknown) {
        throw error instanceof Error ? error : new HostUnavailableError();
      }
    };

    const cancel = async (): Promise<void> => {
      if (closed) {
        return;
      }
      await request("/cancel", "POST", null, false);
    };

    const close = async (): Promise<void> => {
      if (closed) {
        return;
      }
      closed = true;
      try {
        await request("", "DELETE", null, false);
      } finally {
        abortStream();
        signal.removeEventListener("abort", abortStream);
      }
    };

    return Object.freeze({
      submitText: (text: string): Promise<void> => request(
        "/messages",
        "POST",
        Object.freeze({ text }),
        true,
      ),
      submitVoiceTranscript: (transcript: string): Promise<void> => request(
        "/voice-transcripts",
        "POST",
        Object.freeze({ transcript }),
        true,
      ),
      decidePermission: (
        approvalRequestId: string,
        decision: "approve" | "deny" | "cancel",
      ): Promise<void> => decision === "cancel"
        ? cancel()
        : request(
            `/permissions/${encodeURIComponent(approvalRequestId)}`,
            "POST",
            Object.freeze({ decision }),
            true,
          ),
      getLocalModels: async (): Promise<LocalModelInventory> => (
        decodeLocalModelInventory(await modelRequest("/models", "GET", null))
      ),
      scanLocalModels: async (): Promise<LocalModelInventory> => (
        decodeLocalModelInventory(await modelRequest("/models/scan", "POST", null))
      ),
      setLocalModelSelection: async (
        selection: LocalModelSelection,
      ): Promise<LocalModelInventory> => (
        decodeLocalModelInventory(await modelRequest(
          "/models/selection",
          "POST",
          Object.freeze({
            mode: selection.mode,
            modelId: selection.modelId,
          }),
        ))
      ),
      getLocalModelStatus: async (): Promise<LocalModelStatus> => (
        decodeLocalModelStatus(await modelRequest("/models/status", "GET", null))
      ),
      cancel,
      close,
    } satisfies LocalModelPresentationSession);
  }
}
