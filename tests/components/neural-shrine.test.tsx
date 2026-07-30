import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const themePath = (fileName: string) => resolve(process.cwd(), "src/theme", fileName);

function readTheme(fileName: string): string {
  const filePath = themePath(fileName);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function stateSelector(tone: string, token: string): RegExp {
  return new RegExp(
    `\\[data-trust-tone="${tone}"\\][\\s\\S]*?--nova-trust-accent:\\s*var\\(--nova-trust-${token}\\)`,
  );
}

describe("Xeno-Organic visual system", () => {
  it("defines a labeled color token for every trust tone", () => {
    const tokens = readTheme("tokens.css");

    expect(tokens).toContain("--nova-trust-trusted-local: var(--nova-local)");
    expect(tokens).toContain("--nova-trust-explicit-cloud: var(--nova-cloud)");
    expect(tokens).toContain("--nova-trust-approval-required: var(--nova-approval)");
    expect(tokens).toContain("--nova-trust-deterministic-deny: var(--nova-deny)");
    expect(tokens).toContain("--nova-trust-fail-closed: var(--nova-unavailable)");
    expect(tokens).toMatch(stateSelector("trusted_local", "trusted-local"));
    expect(tokens).toMatch(stateSelector("explicit_cloud", "explicit-cloud"));
    expect(tokens).toMatch(stateSelector("approval_required", "approval-required"));
    expect(tokens).toMatch(stateSelector("deterministic_deny", "deterministic-deny"));
    expect(tokens).toMatch(stateSelector("fail_closed", "fail-closed"));
  });

  it("uses amber only for approval and red only for deny containment", () => {
    const tokens = readTheme("tokens.css");
    const colorTokenNames = [...tokens.matchAll(/(--nova-[\w-]+):\s*(#[\da-f]{6})/gi)]
      .filter(([, , value]) => value === "#ffc857" || value === "#ff4d5e")
      .map(([, name]) => name);

    expect(colorTokenNames).toEqual(["--nova-approval", "--nova-deny"]);
  });

  it("defines reduced-motion replacements for every continuous animation", () => {
    const motion = readTheme("motion.css");
    const global = readTheme("global.css");

    for (const animation of [
      "nova-breathe",
      "nova-path-pulse",
      "nova-listen-ripple",
      "nova-process-shift",
    ]) {
      expect(motion).toContain(`@keyframes ${animation}`);
    }

    expect(global).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*1ms\s*!important/);
    expect(global).toContain("animation-iteration-count: 1 !important");
    expect(global).toContain("transition-duration: 1ms !important");
  });

  it("does not use animation to delay pointer or keyboard controls", () => {
    const theme = ["tokens.css", "motion.css", "global.css"].map(readTheme).join("\n");

    expect(theme).toContain("@keyframes nova-breathe");
    expect(theme).not.toMatch(/animation-delay\s*:/);
  });

  it("defines high-contrast critical-surface tokens", () => {
    const global = readTheme("global.css");

    expect(global).toMatch(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*?\.nova-critical-surface\s*\{[\s\S]*?background:\s*var\(--nova-surface-void\)/);
    expect(global).toMatch(/\.nova-critical-surface\s*\{[\s\S]*?backdrop-filter:\s*none/);
    expect(global).toMatch(/\.nova-critical-surface\s*\{[\s\S]*?border-width:\s*2px/);
  });
});
