import { describe, expect, it, vi } from "vitest";

import {
  decodeLocalModelInventory,
  type LocalModelInventory,
} from "../../src/domain/local-models";
import { HttpPresentationHost } from "../../src/host/http-presentation-host";
import type { PresentationHostHandlers } from "../../src/host/presentation-host";

const TOKEN = "tablet-session-token";
const MODEL_ID = `local_${"a".repeat(64)}`;

function inventory(
  version = 1,
  mode: "auto-local" | "manual-local" = "auto-local",
): unknown {
  return {
    version,
    scannedAt: "2026-08-16T18:20:00+00:00",
    selection: {
      mode,
      modelId: mode === "manual-local" ? MODEL_ID : null,
    },
    models: [
      {
        modelId: MODEL_ID,
        displayName: "Dolphin Mixtral 8x7B",
        engine: "ollama",
        source: "ollama",
        sizeBytes: 31_000_000_000,
        parameterCount: 47_000_000_000,
        quantization: "Q4_0",
        contextLength: 32_768,
        capabilities: {
          text: true,
          vision: false,
          tools: false,
          embeddings: false,
          reasoning: false,
        },
        runtimeState: "ready",
        failureCode: null,
      },
    ],
  };
}

function handlers(): PresentationHostHandlers {
  return {
    onEvent: () => undefined,
    onFatalError: () => undefined,
  };
}

describe("local model inventory decoding", () => {
  it("accepts only the sanitized public model schema", () => {
    const decoded = decodeLocalModelInventory(inventory());

    expect(decoded.models).toHaveLength(1);
    expect(decoded.models[0]).toMatchObject({
      modelId: MODEL_ID,
      displayName: "Dolphin Mixtral 8x7B",
      engine: "ollama",
      runtimeState: "ready",
    });
    expect(decoded.selection).toEqual({ mode: "auto-local", modelId: null });
  });

  it("rejects host-native identities or private paths even if other fields are valid", () => {
    const candidate = inventory() as Record<string, unknown>;
    const models = candidate.models as Array<Record<string, unknown>>;
    const model = models[0];
    if (model === undefined) {
      throw new Error("test fixture did not contain a model");
    }
    model.nativeId = "dolphin-mixtral:8x7b-v2.7";
    model.privateLocation = "/workspace/models/private.gguf";

    expect(() => decodeLocalModelInventory(candidate)).toThrow();
  });

  it("rejects invalid stable model ids and oversized inventories", () => {
    const invalid = inventory() as Record<string, unknown>;
    const invalidModels = invalid.models as Array<Record<string, unknown>>;
    const model = invalidModels[0];
    if (model === undefined) {
      throw new Error("test fixture did not contain a model");
    }
    model.modelId = "/workspace/private.gguf";
    expect(() => decodeLocalModelInventory(invalid)).toThrow();

    const tooMany = inventory() as Record<string, unknown>;
    const row = (tooMany.models as unknown[])[0];
    tooMany.models = Array.from({ length: 257 }, () => row);
    expect(() => decodeLocalModelInventory(tooMany)).toThrow();
  });
});

describe("HttpPresentationHost local model controls", () => {
  it("gets, scans, selects, and reads model status through the authenticated session API", async () => {
    const requests: Array<{
      url: string;
      method: string;
      authorization: string | null;
      body: unknown;
    }> = [];

    const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      let body: unknown = null;
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body) as unknown;
      }
      requests.push({
        url,
        method: init?.method ?? "GET",
        authorization: headers.get("authorization"),
        body,
      });

      if (url.endsWith("/v1/presentation/sessions")) {
        return new Response(
          JSON.stringify({ sessionId: "session-1", protocolVersion: "tablet-v1" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/events")) {
        return new Response(
          `${JSON.stringify({ kind: "session_closed", payload: { reason: "completed" } })}\n`,
          { status: 200, headers: { "content-type": "application/x-ndjson" } },
        );
      }
      if (url.endsWith("/models/scan")) {
        return new Response(JSON.stringify(inventory(2)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/models/selection")) {
        return new Response(JSON.stringify(inventory(2, "manual-local")), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/models/status")) {
        return new Response(
          JSON.stringify({
            selection: { mode: "manual-local", modelId: MODEL_ID },
            answeringModel: {
              modelId: MODEL_ID,
              displayName: "Dolphin Mixtral 8x7B",
              engine: "ollama",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify(inventory()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const host = new HttpPresentationHost(
      "https://nova.example.test",
      TOKEN,
      fetchImpl,
    );
    const session = await host.connect(handlers(), new AbortController().signal);

    const initial: LocalModelInventory = await session.getLocalModels();
    const scanned = await session.scanLocalModels();
    const selected = await session.setLocalModelSelection({
      mode: "manual-local",
      modelId: MODEL_ID,
    });
    const status = await session.getLocalModelStatus();

    expect(initial.selection).toEqual({ mode: "auto-local", modelId: null });
    expect(scanned.version).toBe(2);
    expect(selected.selection).toEqual({ mode: "manual-local", modelId: MODEL_ID });
    expect(status).toEqual({
      selection: { mode: "manual-local", modelId: MODEL_ID },
      answeringModel: {
        modelId: MODEL_ID,
        displayName: "Dolphin Mixtral 8x7B",
        engine: "ollama",
      },
    });

    for (const request of requests.filter((value) => value.url.includes("/models"))) {
      expect(request.authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(
      requests.find((request) => request.url.endsWith("/models/selection"))?.body,
    ).toEqual({ mode: "manual-local", modelId: MODEL_ID });
  });
});
