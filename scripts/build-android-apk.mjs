import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";
const gradleCommand = isWindows ? "gradlew.bat" : "./gradlew";
const androidDirectory = resolve(process.cwd(), "android");

const result = spawnSync(gradleCommand, ["assembleDebug"], {
  cwd: androidDirectory,
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
