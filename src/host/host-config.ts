export interface HostEnvironment {
  readonly VITE_NOVA_HOST_MODE?: string;
  readonly VITE_NOVA_HOST_BASE_URL?: string;
  readonly VITE_NOVA_ALLOW_INSECURE_HOST?: string;
}

export type HostConfig =
  | { readonly mode: "demo" }
  | {
      readonly mode: "remote";
      readonly baseUrl: string | null;
    };

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

export function loadHostConfig(
  environment: HostEnvironment = import.meta.env as HostEnvironment,
): HostConfig {
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
  });
}
