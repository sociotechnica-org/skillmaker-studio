import { expect, test } from "@playwright/test";
import { openSkill } from "./runtime.ts";

test("Chat renders its composer and typing is never blocked", async ({ page }) => {
  await openSkill(page, "fixture-maestro");
  await page.getByRole("button", { name: /^chat$/i }).click();

  const composer = page.locator("textarea");
  await expect(composer).toBeVisible();
  await expect(composer).toBeEnabled();
  await composer.fill("Typing remains available without starting an agent turn.");
  await expect(composer).toHaveValue("Typing remains available without starting an agent turn.");
});
