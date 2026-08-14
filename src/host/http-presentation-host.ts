import type { HostPresentationEvent } from "../domain/presentation-events";
import { validateHostEvent } from "../security/validate-host-event";
import type {
  PresentationHostAdapter,
  PresentationHostHandlers,
  PresentationSession,
} from "./presentation-host";

const JSON_HEADERS = Object.freeze({
  accept: "application/json",
  "content-type": "application/json",
});

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

interface EventEnvelope {
  readonly events: readonly HostPresentationEvent[];
}

interface SessionEnvelope extends EventEnvelope {
  readonly sessionId: string;
}

type FetchImplementation = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatedEvents(value: unknown): readonly HostPresentationEvent[] {
  if (!Array.isArray(value)) {
    throw new HostUnavailableError();
  }

  const events: HostPresentationEvent[] = [];
  for (const candidate of value) {
    const validation = validateHostEvent(candidate);
    if (!validation.ok) {
      throw new InvalidPresentationEventError();
    }
    events.push(validation.event);
  }
  return Object.freeze(events);
}

async function decodeEventEnvelope(response: Response): Promise<EventEnvelope> {
  if (!response.ok) {
    throw new HostUnavailableError();
  }
  if (response.status === 204) {
    return Object.freeze({ events: Object.freeze([]) });
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new HostUnavailableError();
  }
  if (!isRecord(value)) {
    throw new HostUnavailableError();
  }

  return Object.freeze({ events: validatedEvents(value.events) });
}

async function decodeSessionEnvelope(response: Response): Promise<SessionEnvelope> {
  if (!response.ok || response.status === 204) {
    throw new HostUnavailableError();
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new HostUnavailableError();
  }
  if (!isRecord(value)) {
    throw new HostUnavailableError();
  }

  const sessionId = value.sessionId;
  if (
    typeof sessionId !== "string"
    || sessionId.length === 0
    || sessionId.length > 512
  ) {
    throw new HostUnavailableError();
  }

  return Object.freeze({
    sessionId,
    events: validatedEvents(value.events),
  });
}

function emitEvents(
  handlers: PresentationHostHandlers,
  events: readonly HostPresentationEvent[],
): void {
  for (const event of events) {
    handlers.onEvent(event);
  }
}

export class HttpPresentationHost implements PresentationHostAdapter {
  constructor(
    private readonly baseUrl: string | null,
    private readonly fetchImpl: FetchImplementation = fetch,
  ) {}

  async connect(
    handlers: PresentationHostHandlers,
    signal: AbortSignal,
  ): Promise<PresentationSession> {
    let fatalSent = false;
    const failFatal = (
      code: "invalid_event" | "host_unavailable",
    ): void => {
      if (fatalSent || signal.aborted) {
        return;
      }
      fatalSent = true;
      handlers.onFatalError(code);
    };
    const classifyFailure = (error: unknown): never => {
      if (error instanceof InvalidPresentationEventError) {
        failFatal("invalid_event");
      } else {
        failFatal("host_unavailable");
      }
      throw error instanceof Error ? error : new HostUnavailableError();
    };

    if (this.baseUrl === null) {
      const error = new HostUnavailableError();
      return classifyFailure(error);
    }

    let connected: SessionEnvelope;
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/presentation/sessions`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          signal,
        },
      );
      connected = await decodeSessionEnvelope(response);
    } catch (error: unknown) {
      return classifyFailure(error);
    }

    emitEvents(handlers, connected.events);

    const sessionId = encodeURIComponent(connected.sessionId);
    const sessionRoot = `${this.baseUrl}/v1/presentation/sessions/${sessionId}`;
    let closed = false;

    const requestEvents = async (
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
          headers: JSON_HEADERS,
        };
        if (body !== null) {
          init.body = JSON.stringify(body);
        }
        if (lifecycleBound) {
          init.signal = signal;
        }

        const response = await this.fetchImpl(`${sessionRoot}${path}`, init);
        const envelope = await decodeEventEnvelope(response);
        if (!signal.aborted) {
          emitEvents(handlers, envelope.events);
        }
      } catch (error: unknown) {
        if (lifecycleBound && !signal.aborted) {
          classifyFailure(error);
        }
        throw error instanceof Error ? error : new HostUnavailableError();
      }
    };

    return Object.freeze({
      submitText: (text: string): Promise<void> => requestEvents(
        "/text",
        "POST",
        Object.freeze({ text }),
        true,
      ),
      submitVoiceTranscript: (transcript: string): Promise<void> => requestEvents(
        "/voice-transcript",
        "POST",
        Object.freeze({ transcript }),
        true,
      ),
      decidePermission: (
        approvalRequestId: string,
        decision: "approve" | "deny" | "cancel",
      ): Promise<void> => requestEvents(
        `/permissions/${encodeURIComponent(approvalRequestId)}`,
        "POST",
        Object.freeze({ decision }),
        true,
      ),
      cancel: async (): Promise<void> => {
        if (closed) {
          return;
        }
        await requestEvents("/cancel", "POST", null, false);
      },
      close: async (): Promise<void> => {
        if (closed) {
          return;
        }
        closed = true;
        await requestEvents("", "DELETE", null, false);
      },
    } satisfies PresentationSession);
  }
}
