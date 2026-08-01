import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  preserveOutput: "never",
  use: {
    baseURL: "http://127.0.0.1:4173",
    screenshot: "off",
    video: "off",
    trace: "off",
  },
  webServer: {
    command: "npm.cmd run build -- --mode e2e && npx.cmd vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/novamind-ready.html",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
