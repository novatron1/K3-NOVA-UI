import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const CAPACITOR_VERSION = "8.4.2";
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const npxCommand = isWindows ? "npx.cmd" : "npx";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(npmCommand, [
  "install",
  "--no-save",
  "--package-lock=false",
  "--no-audit",
  "--no-fund",
  `@capacitor/core@${CAPACITOR_VERSION}`,
  `@capacitor/android@${CAPACITOR_VERSION}`,
  `@capacitor/cli@${CAPACITOR_VERSION}`,
]);

rmSync(resolve(process.cwd(), "android"), {
  recursive: true,
  force: true,
});

run(npxCommand, ["cap", "add", "android"]);
run(npxCommand, ["cap", "sync", "android"]);
