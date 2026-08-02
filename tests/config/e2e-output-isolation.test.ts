import { resolve } from "node:path";

import { loadConfigFromFile } from "vite";
import { describe, expect, it } from "vitest";

import playwrightConfig from "../../playwright.config";

const E2E_OUTPUT_DIRECTORY = ".playwright-dist";

async function viteOutputDirectory(mode: "production" | "e2e"): Promise<string> {
  const loaded = await loadConfigFromFile(
    { command: "build", mode },
    resolve("vite.config.ts"),
  );

  expect(loaded).not.toBeNull();
  return loaded?.config.build?.outDir ?? "dist";
}

describe("browser-test output isolation", () => {
  it("keeps production and E2E builds in distinct output directories", async () => {
    expect(await viteOutputDirectory("production")).toBe("dist");
    expect(await viteOutputDirectory("e2e")).toBe(E2E_OUTPUT_DIRECTORY);
  });

  it("previews the dedicated E2E output directory", () => {
    const webServer = playwrightConfig.webServer;
    expect(Array.isArray(webServer)).toBe(false);
    expect(webServer && !Array.isArray(webServer) ? webServer.command : null).toContain(
      `vite preview --outDir ${E2E_OUTPUT_DIRECTORY}`,
    );
  });
});
