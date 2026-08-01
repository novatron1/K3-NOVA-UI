import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  ...(mode === "e2e"
    ? {
        build: {
          rollupOptions: {
            input: {
              main: fileURLToPath(new URL("./index.html", import.meta.url)),
              canonicalStates: fileURLToPath(new URL(
                "./tests/e2e/canonical-states.html",
                import.meta.url,
              )),
            },
          },
        },
      }
    : {}),
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
}));
