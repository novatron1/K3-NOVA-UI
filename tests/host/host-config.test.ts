import { describe, expect, it } from "vitest";

import { loadHostConfig } from "../../src/host/host-config";

describe("loadHostConfig", () => {
  it("defaults to the existing demo mode", () => {
    expect(loadHostConfig({})).toEqual({ mode: "demo" });
  });

  it("normalizes a valid HTTPS remote backend", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "https://nova.example.test/api/",
    })).toEqual({
      mode: "remote",
      baseUrl: "https://nova.example.test/api",
    });
  });

  it("keeps remote mode fail-closed when the backend URL is missing", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
    })).toEqual({
      mode: "remote",
      baseUrl: null,
    });
  });

  it("rejects non-HTTP protocols", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "file:///tmp/nova",
    })).toEqual({
      mode: "remote",
      baseUrl: null,
    });
  });

  it("rejects insecure HTTP unless it is explicitly enabled", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "http://192.168.1.50:8000/",
    })).toEqual({
      mode: "remote",
      baseUrl: null,
    });

    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "remote",
      VITE_NOVA_HOST_BASE_URL: "http://192.168.1.50:8000/",
      VITE_NOVA_ALLOW_INSECURE_HOST: "1",
    })).toEqual({
      mode: "remote",
      baseUrl: "http://192.168.1.50:8000",
    });
  });

  it("treats unknown runtime modes as demo rather than guessing remote access", () => {
    expect(loadHostConfig({
      VITE_NOVA_HOST_MODE: "something-else",
      VITE_NOVA_HOST_BASE_URL: "https://nova.example.test",
    })).toEqual({ mode: "demo" });
  });
});
