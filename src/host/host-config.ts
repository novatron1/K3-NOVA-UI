export interface HostEnvironment {
  readonly VITE_NOVA_HOST_MODE?: string;
  readonly VITE_NOVA_HOST_BASE_URL?: string;
  readonly VITE_NOVA_ALLOW_INSECURE_HOST?: string;
  readonly VITE_NOVA_SESSION_TOKEN?: string;
}

export type HostConfig =
  | { readonly mode: "demo" }
  | {
      readonly mode: "termux";
      readonly baseUrl: "http://127.0.0.1:8765";
    }
  | {
      readonly mode: "remote";
      readonly baseUrl: string | null;
      readonly sessionToken: string | null;
    };

const TERMUX_BASE_URL = "http://127.0.0.1:8765" as const;

function normalizedBaseUrl(
  rawValue: string | undefined,
  allowInsecure: boolean,
): string | null {
  const candidate = rawValue?.trim();
  if (candidate === undefined || candidate.length === 0) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  if (parsed.protocol === "http:" && !allowInsecure) {
    return null;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return null;
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

function normalizedSessionToken(rawValue: string | undefined): string | null {
  const candidate = rawValue?.trim();
  if (candidate === undefined || candidate.length === 0 || candidate.length > 1024) {
    return null;
  }
  return candidate;
}

export function loadHostConfig(
  environment: HostEnvironment = import.meta.env as HostEnvironment,
): HostConfig {
  if (environment.VITE_NOVA_HOST_MODE === "termux") {
    return Object.freeze({
      mode: "termux",
      baseUrl: TERMUX_BASE_URL,
    });
  }

  if (environment.VITE_NOVA_HOST_MODE !== "remote") {
    return Object.freeze({ mode: "demo" });
  }

  const allowInsecure = environment.VITE_NOVA_ALLOW_INSECURE_HOST === "1";
  return Object.freeze({
    mode: "remote",
    baseUrl: normalizedBaseUrl(
      environment.VITE_NOVA_HOST_BASE_URL,
      allowInsecure,
    ),
    sessionToken: normalizedSessionToken(environment.VITE_NOVA_SESSION_TOKEN),
  });
}
