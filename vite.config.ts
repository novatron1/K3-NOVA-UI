import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
