import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { startNovaInTermux } from "../host/termux-bridge";
import { TermuxPresentationHost } from "../host/termux-presentation-host";
import { usePresentationController } from "../state/use-presentation-controller";
import { UnavailableVoiceCapture } from "../voice/voice-capture";
import { NovaMindApp } from "./NovaMindApp";
import styles from "./TermuxNovaMind.module.css";

const TOKEN_STORAGE_KEY = "k3-nova.termux-token.v1";

type ConnectionPhase =
  | "pairing"
  | "checking"
  | "offline"
  | "loading"
  | "ready"
  | "denied"
  | "error";

interface StatusPayload {
  readonly modelReady: boolean;
}

function readStoredToken(): string | null {
  try {
    const value = window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim();
    return value === undefined || value === null || value.length === 0
      ? null
      : value;
  } catch {
    return null;
  }
}

function storeToken(value: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, value);
  } catch {
    // A storage failure leaves the token in memory for this app session.
  }
}

function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // The in-memory token is still cleared below.
  }
}

async function readStatus(
  baseUrl: string,
  token: string,
): Promise<StatusPayload | "denied" | null> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/status`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (response.status === 401) {
    return "denied";
  }
  if (!response.ok) {
    return null;
  }

  try {
    const value: unknown = await response.json();
    if (
      typeof value !== "object"
      || value === null
      || Array.isArray(value)
      || !("model_ready" in value)
    ) {
      return null;
    }
    return {
      modelReady: (value as Record<string, unknown>).model_ready === true,
    };
  } catch {
    return null;
  }
}

async function askBackendToStartModel(
  baseUrl: string,
  token: string,
): Promise<void> {
  try {
    await fetch(`${baseUrl}/backend/start-model`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
  } catch {
    // Startup polling below remains the source of truth.
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function ConnectedNovaMind({
  baseUrl,
  token,
}: {
  readonly baseUrl: string;
  readonly token: string;
}) {
  const [host] = useState(
    () => new TermuxPresentationHost(baseUrl, token),
  );
  const [voice] = useState(() => new UnavailableVoiceCapture());
  const controller = usePresentationController(host, voice);

  return <NovaMindApp state={controller} controller={controller} />;
}

export function TermuxNovaMind({
  baseUrl,
}: {
  readonly baseUrl: string;
}) {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [draftToken, setDraftToken] = useState(() => readStoredToken() ?? "");
  const [phase, setPhase] = useState<ConnectionPhase>(
    token === null ? "pairing" : "checking",
  );
  const [detail, setDetail] = useState(
    token === null
      ? "Pair this app with the bearer token stored by Nova in Termux."
      : "Checking the on-device Nova backend…",
  );

  const waitForReady = useCallback(async (
    activeToken: string,
    launchTermux: boolean,
  ): Promise<void> => {
    setPhase("checking");
    setDetail("Checking the on-device Nova backend…");

    const initialStatus = await readStatus(baseUrl, activeToken);
    if (initialStatus === "denied") {
      setPhase("denied");
      setDetail("Nova rejected this token. Paste the current token from Termux.");
      return;
    }
    if (initialStatus?.modelReady === true) {
      setPhase("ready");
      setDetail("Nova is ready.");
      return;
    }

    let bridgeFailed = false;
    if (initialStatus === null && launchTermux) {
      setDetail("Nova is offline. Asking Android to start Termux…");
      try {
        await startNovaInTermux();
      } catch {
        bridgeFailed = true;
        setPhase("offline");
        setDetail(
          "Nova is not running. Open Termux and run: bash ~/nova/termux/start_nova.sh — then return here and tap Retry startup.",
        );
      }
    }

    let startRequested = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const status = await readStatus(baseUrl, activeToken);
      if (status === "denied") {
        setPhase("denied");
        setDetail("Nova rejected this token. Paste the current token from Termux.");
        return;
      }
      if (status !== null) {
        if (status.modelReady) {
          setPhase("ready");
          setDetail("Nova is ready.");
          return;
        }
        setPhase("loading");
        setDetail("Nova backend is online. Loading the selected GGUF model…");
        if (!startRequested) {
          startRequested = true;
          void askBackendToStartModel(baseUrl, activeToken);
        }
      } else if (attempt > 2) {
        setPhase("offline");
        setDetail(
          bridgeFailed
            ? "Waiting for Nova. Start it manually in Termux with: bash ~/nova/termux/start_nova.sh"
            : "Waiting for the Nova backend on 127.0.0.1:8765…",
        );
      }
      await delay(1000);
    }

    setPhase("error");
    setDetail(
      "Nova did not become ready in 90 seconds. Open Termux and check the Nova logs.",
    );
  }, [baseUrl]);

  useEffect(() => {
    if (token === null) {
      return;
    }
    let active = true;
    void (async () => {
      const status = await readStatus(baseUrl, token);
      if (!active) {
        return;
      }
      if (status === "denied") {
        setPhase("denied");
        setDetail("Nova rejected this token. Paste the current token from Termux.");
        return;
      }
      if (status?.modelReady === true) {
        setPhase("ready");
        setDetail("Nova is ready.");
        return;
      }
      setPhase(status === null ? "offline" : "loading");
      setDetail(
        status === null
          ? "Nova is not running yet. Start it through Termux."
          : "Nova backend is online, but the selected model is still loading.",
      );
    })();
    return () => {
      active = false;
    };
  }, [baseUrl, token]);

  const pair = async (): Promise<void> => {
    const candidate = draftToken.trim();
    if (candidate.length === 0 || candidate.length > 1024) {
      setPhase("denied");
      setDetail("Enter the current Nova bearer token.");
      return;
    }
    storeToken(candidate);
    setToken(candidate);
    await waitForReady(candidate, true);
  };

  const forget = (): void => {
    clearToken();
    setToken(null);
    setDraftToken("");
    setPhase("pairing");
    setDetail("Pair this app with the bearer token stored by Nova in Termux.");
  };

  if (phase === "ready" && token !== null) {
    return (
      <div className={styles.connected}>
        <div className={styles.localBadge}>
          <span>On-device Termux</span>
          <button type="button" onClick={forget}>Change token</button>
        </div>
        <ConnectedNovaMind
          key={token}
          baseUrl={baseUrl}
          token={token}
        />
      </div>
    );
  }

  const busy = phase === "checking" || phase === "loading";

  return (
    <main className={styles.root}>
      <section className={styles.card} aria-labelledby="termux-title">
        <p className={styles.eyebrow}>K3 Nova · local companion</p>
        <h1 id="termux-title">Connect to Nova in Termux</h1>
        <p className={styles.detail} role="status">{detail}</p>

        <label className={styles.tokenField}>
          <span>Nova bearer token</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draftToken}
            onChange={(event) => setDraftToken(event.currentTarget.value)}
            placeholder="Paste ~/.nova/token"
          />
        </label>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={() => void pair()}
          >
            {busy ? "Connecting…" : "Connect to Nova"}
          </button>
          {token === null
            ? null
            : (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void waitForReady(token, true)}
                >
                  Retry startup
                </button>
              )}
        </div>

        <p className={styles.hint}>
          If Android does not expose the Termux command permission, start Nova
          manually in Termux with <code>bash ~/nova/termux/start_nova.sh</code>.
          K3 Nova will connect to the running local backend directly.
        </p>
      </section>
    </main>
  );
}
