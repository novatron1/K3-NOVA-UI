import {
  mkdirSync,
  linkSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const scanner = resolve("scripts/verify-pages-artifact.mjs");
const temporaryDirectories: string[] = [];

function artifact(): string {
  const root = mkdtempSync(join(tmpdir(), "k3-nova-pages-"));
  temporaryDirectories.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const target = join(root, relativePath);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function scan(root: string) {
  return spawnSync(process.execPath, [scanner, root], {
    encoding: "utf8",
    windowsHide: true,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Pages artifact scanner", () => {
  it("accepts a static production artifact", () => {
    const root = artifact();
    writeArtifact(root, "index.html", '<script src="/K3-NOVA-UI/assets/app.js"></script>');
    writeArtifact(root, "assets/app.js", 'document.body.textContent = "NovaMind";');

    const result = scan(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("pages_artifact_verified");
    expect(result.stderr).toBe("");
  });

  it("rejects a canonical-state artifact without exposing its path", () => {
    const root = artifact();
    writeArtifact(root, "canonical-states.html", "fixture");

    const result = scan(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pages_artifact_rejected:test_artifact");
    expect(result.stderr).not.toContain("canonical-states");
  });

  it("rejects an E2E route without exposing its path", () => {
    const root = artifact();
    writeArtifact(root, "tests/e2e/state.html", "fixture");

    const result = scan(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pages_artifact_rejected:test_artifact");
    expect(result.stderr).not.toContain("tests/e2e");
  });

  it("rejects a hard-linked file without reading or exposing its content", () => {
    const root = artifact();
    const outside = artifact();
    const outsideFile = join(outside, "runtime-state.txt");
    const sentinel = "PRIVATE_RUNTIME_STATE_SENTINEL";
    writeFileSync(outsideFile, sentinel, "utf8");
    linkSync(outsideFile, join(root, "linked-runtime-state.txt"));

    const result = scan(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pages_artifact_rejected:linked_artifact");
    expect(result.stderr).not.toContain(sentinel);
  });

  it.each([
    ["synthetic_prompt", "SYNTHETIC_UNTRUSTED_PROMPT_7F3A"],
    ["synthetic_policy", "SYNTHETIC_FAKE_POLICY_91C2"],
    ["synthetic_reasoning", "SYNTHETIC_HIDDEN_REASONING_5E6F"],
    ["credential", ["sk", "A".repeat(24)].join("-")],
    ["private_key", ["BEGIN", "OPENSSH PRIVATE KEY"].join(" ")],
    ["secret_label", "api_key"],
    ["authorization", "Authorization: Bearer SENTINEL_VALUE"],
  ])("rejects %s content without echoing it", (reasonCode, content) => {
    const root = artifact();
    writeArtifact(root, "assets/app.js", content);

    const result = scan(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`pages_artifact_rejected:${reasonCode}`);
    expect(result.stderr).not.toContain(content);
  });
});
