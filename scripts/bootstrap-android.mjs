import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const npxCommand = isWindows ? "npx.cmd" : "npx";
const nodeCommand = process.execPath;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: isWindows,
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

rmSync(resolve(process.cwd(), "android"), {
  recursive: true,
  force: true,
});

run(npxCommand, ["cap", "add", "android"]);
run(npxCommand, ["cap", "sync", "android"]);
run(nodeCommand, ["scripts/patch-termux-android.mjs"]);
