import { expect, test } from "@playwright/test";

const DOLPHIN_ID = `local_${"a".repeat(64)}`;


test("scan and switch local models from the NovaMind surface", async ({ page }) => {
  await page.goto("/");

  const models = page.getByRole("region", { name: "Local models" });
  await expect(models).toBeVisible();

  const picker = models.getByRole("combobox", { name: "Model" });
  await expect(picker.locator("option")).toHaveCount(3);
  await expect(picker.locator("option").first()).toHaveText("Auto");

  await picker.selectOption(DOLPHIN_ID);
  await expect(picker).toHaveValue(DOLPHIN_ID);

  const scan = models.getByRole("button", { name: "Scan Local Models" });
  await scan.click();
  await expect(scan).toBeEnabled();

  await picker.selectOption("auto-local");
  await expect(picker).toHaveValue("auto-local");

  await expect(page.locator("body")).not.toContainText("/workspace/");
  await expect(page.locator("body")).not.toContainText("C:\\models\\");
  await expect(page.locator("body")).not.toContainText("privateLocation");
  await expect(page.locator("body")).not.toContainText("nativeId");
});
