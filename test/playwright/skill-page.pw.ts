import { expect, test } from "@playwright/test";
import { openSkill } from "./runtime.ts";

test("all skill tabs switch, the tab bar stays sticky, and the overview overlay renders", async ({ page }) => {
  await openSkill(page, "fixture-maestro");

  const tabs = ["Overview", "Research", "Prompt", "Eval", "Publish"] as const;
  for (const tab of tabs) {
    const tabButton = page.locator("main").getByRole("button", { name: tab, exact: true });
    await tabButton.click();
    await expect(tabButton).toHaveClass(/bg-well/);
  }

  await page.getByRole("button", { name: "Research", exact: true }).click();
  // Sticky invariant: after scrolling long research content, the tab bar
  // pins to the top of the scroll context (main) instead of scrolling away.
  const main = page.locator("main");
  const tabBar = main.locator("div.sticky");
  await main.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const mainBox = await main.boundingBox();
  const barBox = await tabBar.boundingBox();
  expect(mainBox).not.toBeNull();
  expect(barBox).not.toBeNull();
  expect(Math.abs((barBox?.y ?? 0) - (mainBox?.y ?? 0))).toBeLessThanOrEqual(1);

  await page.getByTitle("Show overview").click();
  const overlay = page.locator("[data-overview-overlay]");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Stage");
  await expect(overlay).toContainText("Version");
  await expect(overlay).toContainText("Coverage");
});
