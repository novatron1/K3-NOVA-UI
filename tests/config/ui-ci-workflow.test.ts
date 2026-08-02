import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function checkoutStep(workflow: string): string {
  const lines = workflow.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => /^\s+- uses: actions\/checkout@v4\s*$/.test(line));

  expect(start).toBeGreaterThanOrEqual(0);

  const indentation = lines[start]?.match(/^(\s*)-/)?.[1] ?? "";
  const nextStep = lines.findIndex(
    (line, index) => index > start && line.startsWith(`${indentation}- `),
  );

  return lines.slice(start, nextStep === -1 ? undefined : nextStep).join("\n");
}

describe("Windows UI CI security boundary", () => {
  it("prevents checkout credentials from persisting into repository-controlled steps", () => {
    const workflow = readFileSync(".github/workflows/ui-ci.yml", "utf8");

    expect(checkoutStep(workflow)).toMatch(
      /\n\s+with:\s*\n\s+persist-credentials:\s*false\s*$/m,
    );
  });
});
