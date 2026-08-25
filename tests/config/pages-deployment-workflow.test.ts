import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/deploy-pages.yml";

function stepFor(workflow: string, action: string): string {
  const lines = workflow.replaceAll("\r\n", "\n").split("\n");
  const usesStart = lines.findIndex((line) =>
    new RegExp(`^\\s+- uses: ${action}(?:\\s+#.*)?$`).test(line),
  );

  expect(usesStart).toBeGreaterThanOrEqual(0);
  const indentation = lines[usesStart]?.match(/^(\s*)-/)?.[1] ?? "";
  const nextStep = lines.findIndex(
    (line, index) => index > usesStart && line.startsWith(`${indentation}- `),
  );

  return lines.slice(usesStart, nextStep === -1 ? undefined : nextStep).join("\n");
}

function jobFor(workflow: string, jobName: string): string {
  const lines = workflow.replaceAll("\r\n", "\n").split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);

  expect(start).toBeGreaterThanOrEqual(0);
  const nextJob = lines.findIndex(
    (line, index) => index > start && /^  [a-zA-Z0-9_-]+:$/.test(line),
  );

  return lines.slice(start, nextJob === -1 ? undefined : nextJob).join("\n");
}

describe("public prototype deployment boundary", () => {
  it("publishes only from reviewed pushes to main", () => {
    const workflow = readFileSync(workflowPath, "utf8").replaceAll("\r\n", "\n");

    expect(workflow).toMatch(
      /^on:\n  push:\n    branches: \[main\]\n\npermissions:\n/m,
    );
  });

  it("builds only the static prototype at its repository path", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const packageManifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageManifest.scripts?.["build:pages"]).toBe(
      "tsc -b && vite build --mode pages --base /K3-NOVA-UI/ && node scripts/ensure-pages-index.mjs",
    );
    expect(workflow).toContain("npm run build:pages");
    expect(workflow).toMatch(
      /uses: actions\/upload-pages-artifact@[0-9a-f]{40}[\s\S]*?path:\s*dist/,
    );
    expect(workflow).not.toContain(".playwright-dist");
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
  });

  it("does not persist the checkout credential into repository-controlled steps", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    expect(stepFor(workflow, "actions/checkout@[0-9a-f]{40}")).toMatch(
      /\n\s+with:\s*\n\s+persist-credentials:\s*false\s*$/m,
    );
  });

  it("withholds publishing authority from repository-controlled commands", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const buildJob = jobFor(workflow, "verify-and-build");
    const deployJob = jobFor(workflow, "deploy");

    expect(workflow).toMatch(/permissions:\s*\n\s+contents:\s*read/);
    expect(buildJob).not.toMatch(/^\s{4}permissions:/m);
    expect(buildJob).not.toMatch(/pages:\s*write|id-token:\s*write/);
    expect(deployJob).toMatch(
      /permissions:\s*\n\s+pages:\s*write\s*\n\s+id-token:\s*write/,
    );
    expect(deployJob).not.toMatch(/^\s+-?\s*run:/m);
    expect(deployJob).not.toContain("actions/checkout");
  });

  it("pins every external action to an immutable commit", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const actionReferences = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map(
      (match) => match[1] ?? "",
    );

    expect(actionReferences).toHaveLength(4);
    expect(actionReferences).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
        expect.stringMatching(/^actions\/setup-node@[0-9a-f]{40}$/),
        expect.stringMatching(/^actions\/upload-pages-artifact@[0-9a-f]{40}$/),
        expect.stringMatching(/^actions\/deploy-pages@[0-9a-f]{40}$/),
      ]),
    );
  });

  it("runs every verification gate before scanning and uploading dist", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const buildJob = jobFor(workflow, "verify-and-build");
    const requiredSequence = [
      "npm ci",
      "npm audit --audit-level high",
      "npx playwright install chromium",
      "npm run compile",
      "npm run lint",
      "npm run test:unit:run",
      "npm run build:pages",
      "npm run test:e2e",
      "node scripts/verify-pages-artifact.mjs dist",
      "actions/upload-pages-artifact@",
    ];
    const positions = requiredSequence.map((command) => buildJob.indexOf(command));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("allows deployment only after the verified artifact job succeeds", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const deployJob = jobFor(workflow, "deploy");

    expect(deployJob).toMatch(/needs:\s*verify-and-build/);
    expect(deployJob).toContain("actions/deploy-pages@");
  });
});
