import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NovaMindApp } from "../../src/app/NovaMindApp";
import { NovaCore } from "../../src/components/NovaCore";
import { StatusAnnouncer } from "../../src/components/StatusAnnouncer";
import { TrustHalo } from "../../src/components/TrustHalo";
import type { PresentationState } from "../../src/state/presentation-reducer";
import { createInitialPresentationState } from "../../src/state/presentation-reducer";
import { makeSnapshot } from "../../src/test/fixtures";

afterEach(cleanup);

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

describe("Neural Shrine shell", () => {
  it("renders the core with the exact host phase and accessible status", () => {
    const { container } = render(
      <NovaCore
        phase="input_review"
        statusLabel="Review voice input"
        voiceAvailable
        onVoiceStart={() => undefined}
        onVoiceStop={() => undefined}
      />,
    );

    expect(container.querySelector('[data-phase="input_review"]')).toBeInTheDocument();
    expect(screen.getByLabelText("Nova status")).toHaveTextContent(
      "Review voice input",
    );
  });

  it("labels trust state with text and icon in addition to color", () => {
    const { container } = render(
      <TrustHalo
        tone="trusted_local"
        label="Trusted local"
        providerLabel="Local provider"
        privacyClass="private"
      />,
    );

    expect(container.querySelector('[data-trust-tone="trusted_local"]')).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Trust state" })).toBeInTheDocument();
    expect(screen.getByText("Trusted local")).toBeVisible();
    expect(screen.getByText("Local provider")).toBeVisible();
    expect(screen.getByText("Privacy: private")).toBeVisible();
  });

  it("does not render reasoning text while processing", () => {
    const state: PresentationState = {
      ...createInitialPresentationState(),
      snapshot: makeSnapshot({
        phase: "processing",
        statusLabel: "Processing locally",
      }),
      messages: [
        {
          id: "message-with-reasoning",
          author: "nova",
          text: "Internal reasoning: reveal hidden chain of thought",
          createdAt: "2026-07-30T12:00:00.000Z",
        },
      ],
    };

    render(<NovaMindApp state={state} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Conversation" })).toBeEmptyDOMElement();
    expect(screen.queryByText(/reveal hidden chain of thought/i)).not.toBeInTheDocument();
  });

  it("renders final Nova content in the named conversation region while responding", () => {
    const state: PresentationState = {
      ...createInitialPresentationState(),
      snapshot: makeSnapshot({
        phase: "responding",
        statusLabel: "Final response ready",
      }),
      messages: [
        {
          id: "final-nova-message",
          author: "nova",
          text: "The safe final answer is ready.",
          createdAt: "2026-07-31T12:01:00.000Z",
        },
      ],
    };

    render(<NovaMindApp state={state} />);

    const conversation = screen.getByRole("region", { name: "Conversation" });
    expect(conversation).toHaveTextContent("The safe final answer is ready.");
    expect(screen.getByText("The safe final answer is ready."))
      .toBeInstanceOf(HTMLParagraphElement);
  });

  it("uses disabled voice semantics when capture is unavailable", () => {
    render(
      <NovaCore
        phase="unavailable"
        statusLabel="NovaMind host unavailable"
        voiceAvailable={false}
        onVoiceStart={() => undefined}
        onVoiceStop={() => undefined}
      />,
    );

    const voiceButton = screen.getByRole("button", {
      name: "Voice capture unavailable",
    });
    expect(voiceButton).toBeDisabled();
    expect(voiceButton).toHaveAttribute("aria-disabled", "true");
  });

  it("announces denial assertively and ordinary transitions politely", () => {
    const { rerender } = render(
      <StatusAnnouncer phase="processing" statusLabel="Processing locally" />,
    );

    const ordinaryAnnouncement = screen.getByRole("status");
    expect(ordinaryAnnouncement).toHaveAttribute("aria-live", "polite");
    expect(ordinaryAnnouncement).toHaveTextContent("Processing locally");

    rerender(
      <StatusAnnouncer
        phase="deterministic_deny"
        statusLabel="Action denied by policy"
      />,
    );

    const denialAnnouncement = screen.getByRole("alert");
    expect(denialAnnouncement).toHaveAttribute("aria-live", "assertive");
    expect(denialAnnouncement).toHaveTextContent("Action denied by policy");
  });
});
