import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "./TermuxDirectChat.module.css";

interface DirectChatProps {
  readonly baseUrl: string;
  readonly token: string;
  readonly onChangeToken: () => void;
}

interface ChatMessage {
  readonly id: string;
  readonly author: "user" | "nova";
  readonly text: string;
}

interface StatusView {
  readonly modelReady: boolean;
  readonly modelLabel: string;
  readonly memoryCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readStatus(
  baseUrl: string,
  token: string,
): Promise<StatusView> {
  const response = await fetch(`${baseUrl}/status`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Status request failed: ${response.status}`);
  }
  const value: unknown = await response.json();
  if (!isRecord(value) || value.ok !== true) {
    throw new Error("Invalid status response");
  }
  const selected = isRecord(value.selected_model) ? value.selected_model : null;
  const modelLabel = selected !== null && typeof selected.display_name === "string"
    ? selected.display_name
    : "Local GGUF";
  return {
    modelReady: value.model_ready === true,
    modelLabel,
    memoryCount: typeof value.memory_count === "number"
      ? value.memory_count
      : 0,
  };
}

function parseSseChunk(
  chunk: string,
  onEvent: (value: unknown) => void,
): string {
  const parts = chunk.split("\n\n");
  const remainder = parts.pop() ?? "";
  for (const part of parts) {
    for (const line of part.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const body = trimmed.slice(5).trim();
      if (body.length === 0) {
        continue;
      }
      try {
        onEvent(JSON.parse(body) as unknown);
      } catch {
        // Ignore malformed individual SSE records without killing the chat.
      }
    }
  }
  return remainder;
}

export function TermuxDirectChat({
  baseUrl,
  token,
  onChangeToken,
}: DirectChatProps) {
  const conversationId = useMemo(
    () => `k3-direct-${Date.now().toString(36)}`,
    [],
  );
  const [status, setStatus] = useState<StatusView | null>(null);
  const [statusText, setStatusText] = useState("Checking Nova…");
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void readStatus(baseUrl, token).then(
      (next) => {
        if (!alive) {
          return;
        }
        setStatus(next);
        setStatusText(next.modelReady ? "Nova ready" : "Model not ready");
      },
      () => {
        if (!alive) {
          return;
        }
        setStatusText("Nova backend unavailable");
      },
    );
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [baseUrl, token]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    const message = draft.trim();
    if (message.length === 0 || busy) {
      return;
    }

    setBusy(true);
    setErrorText(null);
    setDraft("");
    const userId = `user-${Date.now().toString(36)}`;
    const novaId = `nova-${Date.now().toString(36)}`;
    setMessages((current) => [
      ...current,
      { id: userId, author: "user", text: message },
    ]);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    try {
      const startResponse = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message,
        }),
        signal: controller.signal,
      });

      if (!startResponse.ok) {
        throw new Error(`Chat request failed: ${startResponse.status}`);
      }

      const startValue: unknown = await startResponse.json();
      if (
        !isRecord(startValue)
        || typeof startValue.request_id !== "string"
        || startValue.request_id.length === 0
      ) {
        throw new Error("Nova did not return a request id");
      }

      const streamResponse = await fetch(
        `${baseUrl}/chat/stream/${encodeURIComponent(startValue.request_id)}`,
        {
          headers: {
            accept: "text/event-stream",
            authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        },
      );

      if (!streamResponse.ok || streamResponse.body === null) {
        throw new Error(`Stream request failed: ${streamResponse.status}`);
      }

      const reader = streamResponse.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let novaText = "";
      let insertedNova = false;

      const handleEvent = (value: unknown): void => {
        if (!isRecord(value) || typeof value.type !== "string") {
          return;
        }

        if (value.type === "start") {
          setStatusText("Nova is thinking…");
          return;
        }

        if (value.type === "token" && typeof value.token === "string") {
          novaText += value.token;
          if (!insertedNova) {
            insertedNova = true;
            setMessages((current) => [
              ...current,
              { id: novaId, author: "nova", text: novaText },
            ]);
          } else {
            setMessages((current) => current.map((item) => (
              item.id === novaId ? { ...item, text: novaText } : item
            )));
          }
          return;
        }

        if (value.type === "done") {
          const finalText = typeof value.text === "string" ? value.text : novaText;
          if (!insertedNova && finalText.length > 0) {
            insertedNova = true;
            setMessages((current) => [
              ...current,
              { id: novaId, author: "nova", text: finalText },
            ]);
          } else if (finalText.length > 0) {
            setMessages((current) => current.map((item) => (
              item.id === novaId ? { ...item, text: finalText } : item
            )));
          }
          setStatusText("Nova ready");
          return;
        }

        if (value.type === "error") {
          const detail = typeof value.error === "string"
            ? value.error
            : "Nova generation failed";
          setErrorText(detail);
        }
      };

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        pending += decoder.decode(value, { stream: true });
        pending = parseSseChunk(pending, handleEvent);
      }
      pending += decoder.decode();
      if (pending.trim().length > 0) {
        parseSseChunk(`${pending}\n\n`, handleEvent);
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        setErrorText(
          error instanceof Error ? error.message : "Nova connection failed",
        );
        setStatusText("Nova connection error");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setBusy(false);
    }
  };

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>K3 Nova · local companion</p>
          <h1>Nova</h1>
          <p className={styles.status}>{statusText}</p>
        </div>
        <button type="button" className={styles.changeToken} onClick={onChangeToken}>
          Change token
        </button>
      </header>

      <section className={styles.info} aria-label="Local Nova status">
        <div>
          <span>Model</span>
          <strong>{status?.modelLabel ?? "Checking…"}</strong>
        </div>
        <div>
          <span>Memory</span>
          <strong>{status === null ? "—" : status.memoryCount}</strong>
        </div>
        <div>
          <span>Backend</span>
          <strong>{status?.modelReady === true ? "Ready" : "Online"}</strong>
        </div>
      </section>

      <section ref={listRef} className={styles.messages} aria-live="polite">
        {messages.length === 0
          ? (
              <div className={styles.empty}>
                <strong>Nova is connected.</strong>
                <span>Type a message below.</span>
              </div>
            )
          : messages.map((message) => (
              <article
                key={message.id}
                className={
                  message.author === "user"
                    ? styles.userMessage
                    : styles.novaMessage
                }
              >
                <span>{message.author === "user" ? "You" : "Nova"}</span>
                <p>{message.text}</p>
              </article>
            ))}
      </section>

      {errorText === null
        ? null
        : (
            <div className={styles.error} role="alert">
              {errorText}
            </div>
          )}

      <form className={styles.composer} onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label="Message Nova"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder="Message Nova…"
          rows={3}
        />
        <div className={styles.composerActions}>
          {busy
            ? (
                <button
                  type="button"
                  className={styles.stop}
                  onClick={() => abortRef.current?.abort()}
                >
                  Stop
                </button>
              )
            : null}
          <button
            type="submit"
            className={styles.send}
            disabled={busy || draft.trim().length === 0}
          >
            {busy ? "Generating…" : "Send"}
          </button>
        </div>
      </form>
    </main>
  );
}
