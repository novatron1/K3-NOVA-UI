import { describe, expect, it } from "vitest";

import { loadHostConfig } from "../../src/host/host-config";

describe("loadHostConfig", () => {
  it("defaults to the existing demo mode", () => {
    expect(loadHostConfig({})).toEqual({ mode: "demo" });
  });

  it("normalizes a valid HTTPS remote backend and revocable presentation token", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "https://nova.example.test/api/",
      VITE_NOVA_SESSION_TOKEN: "  tablet-session-token  ",
    })).toEqual({
      mode: "remote",
      baseUrl: "https://nova.example.test/api",
      sessionToken: "tablet-session-token",
    });
  });

  it("keeps remote mode fail-closed when URL or token is missing", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
    })).toEqual({ mode: "remote", baseUrl: null, sessionToken: null });

    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "https://nova.example.test",
    })).toEqual({
      mode: "remote",
      baseUrl: "https://nova.example.test",
      sessionToken: null,
    });
  });

  it("rejects non-HTTP protocols", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "file:///tmp/nova",
      VITE_NOVA_SESSION_TOKEN: "token",
    })).toEqual({ mode: "remote", baseUrl: null, sessionToken: "token" });
  });

  it("rejects insecure HTTP unless it is explicitly enabled", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "http://192.168.1.50:8000/",
      VITE_NOVA_SESSION_TOKEN: "token",
    })).toEqual({ mode: "remote", baseUrl: null, sessionToken: "token" });

    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "http://192.168.1.50:8000/",
      VITE_NOVA_ALLOW_INSECURE_HOST: "1",
      VITE_NOVA_SESSION_TOKEN: "token",
    })).toEqual({
      mode: "remote",
      baseUrl: "http://192.168.1.50:8000",
      sessionToken: "token",
    });
  });

  it("treats unknown runtime modes as demo rather than guessing remote access", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "something-else",
      VITE_NOVA_HOST_BASE_URL: "https://nova.example.test",
      VITE_NOVA_SESSION_TOKEN: "token",
    })).toEqual({ mode: "demo" });
  });

  it("pins Termux mode to the on-device loopback backend", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "termux",
      VITE_NOVA_HOST_BASE_URL: "https://should-not-be-used.example.test",
      VITE_NOVA_SESSION_TOKEN: "should-not-be-baked",
    })).toEqual({
      mode: "termux",
      baseUrl: "http://127.0.0.1:8765",
    });
  });

});
