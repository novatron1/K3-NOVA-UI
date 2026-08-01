import { expect, test, type Locator, type Page } from "@playwright/test";

async function boxWithinViewport(locator: Locator, page: Page): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();

  if (box === null || viewport === null) {
    throw new Error("Expected the control and viewport to be available.");
  }

  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
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
