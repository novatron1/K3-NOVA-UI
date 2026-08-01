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
