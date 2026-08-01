import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const AXE_BROWSER_PATH = resolve(
  process.cwd(),
  "node_modules",
  "axe-core",
  "axe.min.js",
);

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

async function expectServedBundleMatchesDist(
  request: APIRequestContext,
): Promise<void> {
  const documentResponse = await request.get("/");
  expect(documentResponse.ok()).toBe(true);
  const documentHtml = await documentResponse.text();
  const assetPaths = Array.from(documentHtml.matchAll(
    /(?:src|href)="(\/assets\/[^"?]+\.(?:css|js))"/gu,
  )).map((match) => match[1]).filter((path): path is string => (
    path !== undefined
  ));
  expect(assetPaths.some((path) => path.endsWith(".css")),
    "served document must reference built CSS").toBe(true);
  expect(assetPaths.some((path) => path.endsWith(".js")),
    "served document must reference built JavaScript").toBe(true);
  expect(new Set(assetPaths).size).toBe(assetPaths.length);

  for (const assetPath of assetPaths) {
    const assetResponse = await request.get(assetPath);
    expect(assetResponse.ok()).toBe(true);
    const [servedAsset, localAsset] = await Promise.all([
      assetResponse.body(),
      readFile(resolve(process.cwd(), "dist", assetPath.slice(1))),
    ]);
    expect(sha256(servedAsset), `served digest for ${assetPath}`)
      .toBe(sha256(localAsset));
  }
}

interface BrowserAxeFinding {
  readonly id: string;
  readonly nodes: readonly {
    readonly any?: readonly {
      readonly data: unknown;
      readonly id: string;
      readonly message: string;
    }[];
    readonly failureSummary?: string;
    readonly target: readonly string[];
  }[];
}

async function expectNoSiblingHitOverlap(locator: Locator): Promise<void> {
  const hasOnlySelfOrAncestorHits = await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return Array.from(range.getClientRects()).every((box) => [
      [box.x + 1, box.y + 1],
      [box.right - 1, box.y + 1],
      [box.x + box.width / 2, box.y + box.height / 2],
      [box.x + 1, box.bottom - 1],
      [box.right - 1, box.bottom - 1],
    ].every(([x = 0, y = 0]) => document.elementsFromPoint(x, y).every(
      (candidate) => (
        candidate === element
        || element.contains(candidate)
        || candidate.contains(element)
      ),
    )));
  });
  expect(hasOnlySelfOrAncestorHits).toBe(true);
}

async function expectChromiumColorEvidence(
  page: Page,
  stateLabel: string,
): Promise<void> {
  await page.addScriptTag({ path: AXE_BROWSER_PATH });
  const results = await page.evaluate(async () => {
    interface AxeApi {
      run(
        context: Document | Element,
        options: {
          readonly runOnly: {
            readonly type: "rule";
            readonly values: readonly string[];
          };
        },
      ): Promise<{
        readonly violations: readonly BrowserAxeFinding[];
        readonly incomplete: readonly BrowserAxeFinding[];
      }>;
    }

    const axe = (globalThis as unknown as { readonly axe?: AxeApi }).axe;
    if (axe === undefined) {
      throw new Error("axe-core was not loaded into Chromium.");
    }

    const context = document.querySelector('[role="alertdialog"]') ?? document;
    return axe.run(context, {
      runOnly: {
        type: "rule",
        values: ["color-contrast", "link-in-text-block"],
      },
    });
  });
  const summarize = (findings: readonly BrowserAxeFinding[]) => findings.map(
    ({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ any, failureSummary, target }) => ({
        any,
        failureSummary,
        target,
      })),
    }),
  );

  expect(summarize(results.violations), `Chromium color violations for ${stateLabel}`)
    .toEqual([]);
  const incomplete = summarize(results.incomplete);
  if (incomplete.length === 0) {
    return;
  }

  expect(incomplete, `Chromium unresolved color targets for ${stateLabel}`)
    .toHaveLength(1);
  expect(incomplete[0]?.id).toBe("color-contrast");
  expect(incomplete[0]?.nodes).toHaveLength(1);
  const target = incomplete[0]?.nodes[0]?.target.join(" ");
  expect(target).toBe('p[aria-label="Nova status"]');
  const status = page.getByLabel("Nova status");
  await expectOpaqueSurfaceTextContrast(status, status);
  await expectNoSiblingHitOverlap(status);
}

async function expectMinimumTargetSize(
  locator: Locator,
  scrollIntoView = true,
): Promise<void> {
  if (scrollIntoView) {
    await locator.scrollIntoViewIfNeeded();
  }
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("Expected a control bounding box.");
  }
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

async function expectTargetSizeAndHitTesting(
  locator: Locator,
  scrollIntoView = true,
): Promise<void> {
  await expectMinimumTargetSize(locator, scrollIntoView);
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("Expected an actionable control bounding box.");
  }
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const centerHit = await locator.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      expected: element.getAttribute("aria-label") ?? element.textContent,
      hit: hit === null
        ? null
        : hit.getAttribute("aria-label") ?? hit.textContent,
      receivesHit: hit === element || (hit !== null && element.contains(hit)),
    };
  }, center);
  expect(
    centerHit.receivesHit,
    `center hit for ${centerHit.expected ?? "unnamed control"}; received ${centerHit.hit ?? "nothing"}`,
  ).toBe(true);
  await locator.click({ trial: true });
  await locator.focus();
  await expect(locator).toBeFocused();
}

async function expectTargetSizeAndCenterHit(
  locator: Locator,
): Promise<{ readonly x: number; readonly y: number }> {
  await expectMinimumTargetSize(locator, false);
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("Expected an actionable control bounding box.");
  }
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const centerHit = await locator.evaluate((element, point) => {
    const hit = document.elementFromPoint(point.x, point.y);
    return {
      expected: element.getAttribute("aria-label") ?? element.textContent,
      hit: hit === null
        ? null
        : hit.getAttribute("aria-label") ?? hit.textContent,
      receivesHit: hit === element || (hit !== null && element.contains(hit)),
    };
  }, center);
  expect(
    centerHit.receivesHit,
    `center hit for ${centerHit.expected ?? "unnamed control"}; received ${centerHit.hit ?? "nothing"}`,
  ).toBe(true);
  return center;
}

async function boxWithinViewport(locator: Locator, page: Page): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();

  if (box === null || viewport === null) {
    throw new Error("Expected the control and viewport to be available.");
  }

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
}

async function expectRenderedFocus(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const focus = await locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      color: styles.outlineColor,
      style: styles.outlineStyle,
      width: styles.outlineWidth,
    };
  });

  expect(focus).toEqual({
    bodyBackground: "rgb(3, 7, 6)",
    color: "rgb(255, 255, 255)",
    style: "solid",
    width: "2px",
  });
}

function parseRgb(color: string): readonly [number, number, number, number] {
  const legacy = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/
    .exec(color);
  if (legacy !== null) {
    return [
      Number(legacy[1]),
      Number(legacy[2]),
      Number(legacy[3]),
      legacy[4] === undefined ? 1 : Number(legacy[4]),
    ];
  }

  const modern = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/
    .exec(color);
  if (modern !== null) {
    return [
      Number(modern[1]) * 255,
      Number(modern[2]) * 255,
      Number(modern[3]) * 255,
      modern[4] === undefined ? 1 : Number(modern[4]),
    ];
  }

  throw new Error(`Expected a computed sRGB color, received ${color}`);
}

function compositeBackgrounds(
  colors: readonly (readonly [number, number, number, number])[],
): readonly [number, number, number] {
  let result: readonly [number, number, number, number] = [0, 0, 0, 0];
  for (const source of [...colors].reverse()) {
    const alpha = source[3] + result[3] * (1 - source[3]);
    if (alpha === 0) {
      continue;
    }
    result = [
      (source[0] * source[3] + result[0] * result[3] * (1 - source[3])) / alpha,
      (source[1] * source[3] + result[1] * result[3] * (1 - source[3])) / alpha,
      (source[2] * source[3] + result[2] * result[3] * (1 - source[3])) / alpha,
      alpha,
    ];
  }

  return [result[0], result[1], result[2]];
}

function relativeLuminance(color: readonly [number, number, number]): number {
  const channels = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * (channels[0] ?? 0)
    + 0.7152 * (channels[1] ?? 0)
    + 0.0722 * (channels[2] ?? 0);
}

async function expectRenderedTextContrast(
  foreground: Locator,
  background: Locator,
): Promise<void> {
  const [foregroundColor, backgroundColor] = await Promise.all([
    foreground.evaluate((element) => getComputedStyle(element).color),
    background.evaluate((element) => {
      const colors: string[] = [];
      let current: Element | null = element;
      while (current !== null) {
        colors.push(getComputedStyle(current).backgroundColor);
        current = current.parentElement;
      }
      return colors;
    }),
  ]);
  const foregroundRgb = parseRgb(foregroundColor);
  const foregroundLuminance = relativeLuminance([
    foregroundRgb[0],
    foregroundRgb[1],
    foregroundRgb[2],
  ]);
  const backgroundLuminance = relativeLuminance(
    compositeBackgrounds(backgroundColor.map(parseRgb)),
  );
  const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);

  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

async function expectOpaqueSurfaceTextContrast(
  foreground: Locator,
  surface: Locator,
): Promise<void> {
  const [foregroundColor, renderedSurface] = await Promise.all([
    foreground.evaluate((element) => getComputedStyle(element).color),
    surface.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        backdropFilter: styles.backdropFilter,
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
      };
    }),
  ]);
  expect(renderedSurface.backgroundImage).toBe("none");
  expect(renderedSurface.backdropFilter).toBe("none");
  const foregroundRgb = parseRgb(foregroundColor);
  const backgroundRgb = parseRgb(renderedSurface.backgroundColor);
  expect(foregroundRgb[3]).toBe(1);
  expect(backgroundRgb[3]).toBe(1);
  const foregroundLuminance = relativeLuminance([
    foregroundRgb[0],
    foregroundRgb[1],
    foregroundRgb[2],
  ]);
  const backgroundLuminance = relativeLuminance([
    backgroundRgb[0],
    backgroundRgb[1],
    backgroundRgb[2],
  ]);
  const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);

  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

async function openPermissionGate(page: Page, text: string): Promise<Locator> {
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(text);
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled();
  await send.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", {
    name: "Permission decision required",
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("served application bundle matches the reviewed local build", async ({
  page,
  request,
}) => {
  await expectServedBundleMatchesDist(request);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "NovaMind" })).toBeVisible();
});

test("desktop centers core and keeps organs on the orbital rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");

  const core = page.getByLabel("Nova core");
  const coreBox = await core.boundingBox();
  const viewport = page.viewportSize();
  const organs = page.getByLabel("Technical status organs");
  const firstOrgan = page.locator(".living-organ").first();
  const lastOrgan = page.locator(".living-organ").last();
  const firstBox = await firstOrgan.boundingBox();
  const lastBox = await lastOrgan.boundingBox();

  expect(coreBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs((coreBox?.x ?? 0) + (coreBox?.width ?? 0) / 2 - (viewport?.width ?? 0) / 2)).toBeLessThan(32);
  await expect(organs).toHaveCSS("position", "absolute");
  expect(firstBox?.x).toBeLessThan(coreBox?.x ?? 0);
  expect(lastBox?.x).toBeGreaterThan((coreBox?.x ?? 0) + (coreBox?.width ?? 0));
});

test("short desktop keeps every organ control reachable", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/");

  const organControls = page.locator(".living-organ button");
  await expect(organControls).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    await boxWithinViewport(organControls.nth(index), page);
  }
});

test("tablet prioritizes conversation and collapses the organ rail", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");

  const conversation = page.getByLabel("Conversation");
  const organs = page.getByLabel("Technical status organs");
  const conversationBox = await conversation.boundingBox();
  const organsBox = await organs.boundingBox();

  expect(conversationBox).not.toBeNull();
  expect(organsBox).not.toBeNull();
  expect(conversationBox?.y).toBeLessThan(organsBox?.y ?? 0);
  await expect(organs).toHaveCSS("overflow-x", "auto");
  await expect(organs).toHaveCSS("position", "static");
});

test("phone exposes organs in a labeled bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const organs = page.getByLabel("Technical status organs");
  const details = await organs.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      position: styles.position,
      bottom: styles.bottom,
      label: getComputedStyle(element, "::before").content,
    };
  });

  expect(details).toEqual({
    position: "fixed",
    bottom: "0px",
    label: '"Living organs"',
  });
});

test("phone keeps permission privacy provider consent cancel and isolation reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByText("No cloud consent required")).toBeVisible();
  for (const name of [
    /Permissions /,
    /Provider and model /,
    /Privacy and consent /,
    /Isolation /,
    "Cancel presentation",
  ]) {
    await boxWithinViewport(page.getByRole("button", { name }), page);
  }
});

test("critical controls remain inside the viewport at 320 CSS pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");

  for (const locator of [
    page.getByLabel("Nova core"),
    page.getByLabel("Message composer"),
    page.getByRole("button", { name: "Cancel presentation" }),
    page.getByLabel("Technical status organs"),
  ]) {
    await boxWithinViewport(locator, page);
  }

  expect(await page.locator("html").evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(320);
});

test("every 320px base control preserves sizing hit ownership and keyboard workflows", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");

  const unavailableVoice = page.getByRole("button", {
    name: "Voice capture unavailable",
  });
  await expect(unavailableVoice).toHaveCount(2);
  for (const voiceControl of await unavailableVoice.all()) {
    await expect(voiceControl).toBeDisabled();
    await expect(voiceControl).toHaveAttribute("aria-disabled", "true");
    await expectMinimumTargetSize(voiceControl);
  }

  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Exercise every narrow-screen control");
  await message.evaluate((element) => {
    element.blur();
  });
  const normalControls = page.locator(
    ".nova-presentation button:not(:disabled), .nova-presentation textarea:not(:disabled)",
  );
  await expect(normalControls).toHaveCount(13);
  for (let index = 0; index < 13; index += 1) {
    await page.keyboard.press("Tab");
    const control = normalControls.nth(index);
    await expect(control).toBeFocused();
    await expectTargetSizeAndHitTesting(control);
  }

  const organControls = page.locator(".living-organ button:not(:disabled)");
  await expect(organControls).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    const organ = organControls.nth(index);
    await organ.focus();
    await page.keyboard.press("Enter");
    await expect(organ).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(organ).toHaveAttribute("aria-expanded", "false");
  }
});

const permissionOutcomes = [
  { choice: "Approve", status: "Fake host approval recorded", tabCount: 0 },
  { choice: "Deny", status: "Action denied by fake host policy", tabCount: 1 },
  { choice: "Cancel", status: "Fake host presentation cancelled", tabCount: 2 },
] as const;

for (const { choice, status: expectedStatus, tabCount } of permissionOutcomes) {
  test(`320px ${choice} decision is pointer actionable in a fresh session`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    const gate = await openPermissionGate(page, `320px ${choice} action`);
    await expect(gate.getByRole("button")).toHaveCount(3);
    const choiceControl = gate.getByRole("button", { name: choice });
    const center = await expectTargetSizeAndCenterHit(choiceControl);
    await page.mouse.click(center.x, center.y);
    await expect(gate).toBeHidden();
    await expect(page.getByLabel("Nova status")).toHaveText(expectedStatus);
  });

  test(`320px ${choice} decision is keyboard actionable in a fresh session`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    const gate = await openPermissionGate(page, `320px keyboard ${choice} action`);
    const choiceControl = gate.getByRole("button", { name: choice });
    await expectTargetSizeAndCenterHit(choiceControl);
    for (let index = 0; index < tabCount; index += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(choiceControl).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(gate).toBeHidden();
    await expect(page.getByLabel("Nova status")).toHaveText(expectedStatus);
  });
}

test("320px cancel control closes a fresh session from the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  const cancel = page.getByRole("button", { name: "Cancel presentation" });
  await expectTargetSizeAndHitTesting(cancel);
  await cancel.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Message" })
    .fill("Submission after cancellation stays inert");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("alertdialog", {
    name: "Permission decision required",
  })).toBeHidden();
});

test("reduced motion removes ambient loops", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator('[data-core-layer="outer-membrane"]')).toHaveCSS("animation-name", "none");
});

test("high contrast removes translucent critical surfaces", async ({ page }) => {
  await page.emulateMedia({ contrast: "more" });
  await page.goto("/");

  await page.locator("body").evaluate((body) => {
    const surface = document.createElement("div");
    surface.className = "nova-critical-surface";
    body.append(surface);
  });
  const criticalSurface = page.locator(".nova-critical-surface");

  await expect(criticalSurface).toHaveCSS("backdrop-filter", "none");
  await expect(criticalSurface).toHaveCSS("background-color", "rgb(3, 7, 6)");
});

test("Chromium resolves color checks across fixed fake-host states", async ({ page }) => {
  await page.goto("/");
  await expectChromiumColorEvidence(page, "idle");

  await openPermissionGate(page, "Chromium color audit approval path");
  await expectChromiumColorEvidence(page, "approval required");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByLabel("Nova status"))
    .toHaveText("Fake host approval recorded");
  await expectChromiumColorEvidence(page, "responding");

  await page.reload();
  await openPermissionGate(page, "Chromium color audit denial path");
  await page.getByRole("button", { name: "Deny" }).click();
  await expect(page.getByRole("alert"))
    .toHaveText("Action denied by fake host policy");
  await expectChromiumColorEvidence(page, "deterministic denial");

  await page.reload();
  await openPermissionGate(page, "Chromium color audit cancellation path");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Nova status"))
    .toHaveText("Fake host presentation cancelled");
  await expectChromiumColorEvidence(page, "cancelled");
});

test("Chromium resolves color checks in all ten fixed canonical phases", async ({ page }) => {
  test.setTimeout(75_000);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/tests/e2e/canonical-states.html");

  for (const { phase, tone } of [
    { phase: "idle", tone: "trusted_local" },
    { phase: "listening", tone: "trusted_local" },
    { phase: "input_review", tone: "trusted_local" },
    { phase: "processing", tone: "explicit_cloud" },
    { phase: "responding", tone: "trusted_local" },
    { phase: "approval_required", tone: "approval_required" },
    { phase: "deterministic_deny", tone: "deterministic_deny" },
    { phase: "paused", tone: "trusted_local" },
    { phase: "cancelled", tone: "trusted_local" },
    { phase: "unavailable", tone: "fail_closed" },
  ] as const) {
    await expect(page.locator("[data-canonical-phase]"))
      .toHaveAttribute("data-canonical-phase", phase, { timeout: 25_000 });
    await expect(page.locator("[data-canonical-phase]"))
      .toHaveAttribute("data-canonical-trust-tone", tone);
    await expectChromiumColorEvidence(page, `canonical ${phase} (${tone})`);
  }
});

test("rendered text-bearing surfaces use opaque WCAG AA backgrounds", async ({ page }) => {
  await page.goto("/");

  const trustSurface = page.locator(".nova-header aside");
  await expectOpaqueSurfaceTextContrast(trustSurface.locator("strong"), trustSurface);
  for (const text of await trustSurface.locator("p").all()) {
    await expectOpaqueSurfaceTextContrast(text, trustSurface);
  }
  const status = page.getByLabel("Nova status");
  await expectOpaqueSurfaceTextContrast(status, status);

  const organs = page.locator(".living-organ");
  await expect(organs).toHaveCount(10);
  for (let index = 0; index < 10; index += 1) {
    const organ = organs.nth(index);
    await expectOpaqueSurfaceTextContrast(
      organ.locator(".living-organ-title"),
      organ,
    );
    await expectOpaqueSurfaceTextContrast(
      organ.locator(".living-organ-summary"),
      organ,
    );
  }

  const composer = page.getByLabel("Message composer");
  for (const privacyCue of await composer.locator(".composer-privacy span").all()) {
    await expectOpaqueSurfaceTextContrast(privacyCue, composer);
  }

  const dialog = await openPermissionGate(page, "Rendered conversation contrast");
  for (const action of await dialog.getByRole("button").all()) {
    await expectOpaqueSurfaceTextContrast(action, action);
  }
  await dialog.getByRole("button", { name: "Approve" }).click();
  const conversation = page.getByRole("article", { name: "User message" });
  await expectOpaqueSurfaceTextContrast(conversation, conversation);
});

test("every enabled control exposes rendered focus in normal and approval phases", async ({ page }) => {
  await page.goto("/");
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Review the keyboard focus contract");
  await message.evaluate((element) => {
    element.blur();
  });

  const normalControls = page.locator(
    ".nova-presentation button:not(:disabled), .nova-presentation textarea:not(:disabled)",
  );
  await expect(normalControls).toHaveCount(13);
  for (let index = 0; index < 13; index += 1) {
    await page.keyboard.press("Tab");
    await expectRenderedFocus(normalControls.nth(index));
  }

  await message.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("alertdialog", {
    name: "Permission decision required",
  });
  await expect(dialog).toBeVisible();
  const gateControls = dialog.getByRole("button");
  await expect(gateControls).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expectRenderedFocus(gateControls.nth(index));
    await page.keyboard.press("Tab");
  }
  await expect(gateControls.first()).toBeFocused();
});

test("reduced motion and forced contrast preserve keyboard workflows and textual cues", async ({ page }) => {
  await page.emulateMedia({
    contrast: "more",
    forcedColors: "active",
    reducedMotion: "reduce",
  });
  await page.goto("/");

  await expect(page.locator('[data-core-layer="outer-membrane"]'))
    .toHaveCSS("animation-name", "none");
  const contract = page.getByRole("button", { name: /^Run contract / });
  await page.keyboard.press("Tab");
  await expect(contract).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(contract).toHaveAttribute("aria-expanded", "true");

  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
  }
  const message = page.getByRole("textbox", { name: "Message" });
  await expect(message).toBeFocused();
  await page.keyboard.type("Check accessibility modes");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send message" })).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("alertdialog", {
    name: "Permission decision required",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Trusted host decision");
  await expect(dialog).toContainText("This action is irreversible.");
  await expect(dialog).toHaveCSS("backdrop-filter", "none");
  await expect(dialog).toHaveCSS("border-width", "2px");

  await page.keyboard.press("Tab");
  const deny = page.getByRole("button", { name: "Deny" });
  await expect(deny).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Action denied by fake host policy");
});

test("rendered normal and approval phases meet WCAG AA color contrast", async ({ page }) => {
  await page.goto("/");

  const message = page.getByRole("textbox", { name: "Message" });
  await expectRenderedTextContrast(message, message);
  await message.fill("Check rendered contrast");
  const send = page.getByRole("button", { name: "Send message" });
  await expect(send).toBeEnabled();
  await expectRenderedTextContrast(send, send);
  await send.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", {
    name: "Permission decision required",
  });
  await expect(dialog).toBeVisible();
  await expectRenderedTextContrast(dialog.getByRole("heading"), dialog);
  await expectRenderedTextContrast(dialog.locator(".permission-gate-eyebrow"), dialog);
  await expectRenderedTextContrast(dialog.locator("dt").first(), dialog);
  await expectRenderedTextContrast(dialog.locator(".permission-gate-warning"), dialog);
  const approve = dialog.getByRole("button", { name: "Approve" });
  await expectRenderedTextContrast(approve, approve);
});

test("multiple fake-host submissions retain distinct inert messages", async ({ page }) => {
  const duplicateKeyErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error"
      && message.text().includes("same key")
      && message.text().includes("fake-demo-user-message")
    ) {
      duplicateKeyErrors.push(message.text());
    }
  });
  await page.goto("/");

  const submitMessage = async (text: string): Promise<void> => {
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill(text);
    const send = page.getByRole("button", { name: "Send message" });
    await expect(send).toBeEnabled();
    await send.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog", {
      name: "Permission decision required",
    })).toBeVisible();
  };

  await submitMessage("First inert browser message");
  await expect(page.getByRole("button", { name: "Approve" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog", {
    name: "Permission decision required",
  })).toBeHidden();

  await submitMessage("Second inert browser message");
  const userMessages = page.locator('[data-author="user"]');
  await expect(userMessages).toHaveCount(2);
  await expect(userMessages.nth(0)).toHaveText("First inert browser message");
  await expect(userMessages.nth(1)).toHaveText("Second inert browser message");
  expect(await userMessages.evaluateAll((messages) => messages.map(
    (message) => message.getAttribute("data-message-id"),
  ))).toEqual([
    "fake-demo-user-message-1",
    "fake-demo-user-message-2",
  ]);
  expect.soft(duplicateKeyErrors).toEqual([]);
  await expect(page.getByRole("button", { name: "Approve" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.soft(page.getByRole("alertdialog", {
    name: "Permission decision required",
  })).toBeHidden();
  await expect(userMessages).toHaveCount(2);
});
