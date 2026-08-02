import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { relative, resolve } from "node:path";

const contentRules = [
  ["synthetic_prompt", /SYNTHETIC_UNTRUSTED_PROMPT_7F3A/],
  ["synthetic_policy", /SYNTHETIC_FAKE_POLICY_91C2/],
  ["synthetic_reasoning", /SYNTHETIC_HIDDEN_REASONING_5E6F/],
  ["credential", /sk-[A-Za-z0-9_-]+/],
  ["private_key", /BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY/],
  ["secret_label", /api[_-]?key/i],
  ["authorization", /authorization/i],
];

function inspectEntry(root, entry, reasons) {
  const metadata = lstatSync(entry);
  if (metadata.isSymbolicLink() || (metadata.isFile() && metadata.nlink > 1)) {
    reasons.add("linked_artifact");
    return;
  }

  if (metadata.isDirectory()) {
    for (const child of readdirSync(entry)) {
      inspectEntry(root, resolve(entry, child), reasons);
    }
    return;
  }

  if (!metadata.isFile()) {
    reasons.add("unsupported_artifact");
    return;
  }

  const artifactPath = relative(root, entry).replaceAll("\\", "/");
  if (/canonical-states|(?:^|\/)tests\/e2e(?:\/|$)/i.test(artifactPath)) {
    reasons.add("test_artifact");
  }

  const content = readFileSync(entry).toString("utf8");
  for (const [reason, pattern] of contentRules) {
    if (pattern.test(content)) {
      reasons.add(reason);
    }
  }
}

export function verifyPagesArtifact(directory) {
  const root = resolve(directory);
  const reasons = new Set();
  if (!existsSync(root)) {
    reasons.add("missing_artifact");
    return [...reasons];
  }

  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink()) {
    reasons.add("linked_artifact");
    return [...reasons];
  }
  if (!rootMetadata.isDirectory()) {
    reasons.add("missing_artifact");
    return [...reasons];
  }

  inspectEntry(root, root, reasons);
  return [...reasons].sort();
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(import.meta.filename)) {
  const reasons = verifyPagesArtifact(process.argv[2] ?? "");
  if (reasons.length > 0) {
    process.stderr.write(`pages_artifact_rejected:${reasons.join(",")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("pages_artifact_verified\n");
  }
}
