import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Android Termux bridge bootstrap", () => {
  it("patches the generated Capacitor app with the mandatory Termux RUN_COMMAND contract", () => {
    const script = readFileSync("scripts/patch-termux-android.mjs", "utf8");

    expect(script).toContain("com.termux.permission.RUN_COMMAND");
    expect(script).toContain("com.termux.app.RunCommandService");
    expect(script).toContain("com.termux.RUN_COMMAND");
    expect(script).toContain("com.termux.RUN_COMMAND_PATH");
    expect(script).toContain("com.termux.RUN_COMMAND_ARGUMENTS");
    expect(script).toContain("com.termux.RUN_COMMAND_WORKDIR");
    expect(script).toContain("com.termux.RUN_COMMAND_BACKGROUND");
    expect(script).toContain("/data/data/com.termux/files/home/nova/termux/start_nova.sh");
  });

  it("runs the Termux patch after Capacitor regenerates Android", () => {
    const bootstrap = readFileSync("scripts/bootstrap-android.mjs", "utf8");
    expect(bootstrap).toContain("patch-termux-android.mjs");
  });
});
