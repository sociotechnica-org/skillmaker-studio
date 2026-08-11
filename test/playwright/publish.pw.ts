import { expect, test } from "@playwright/test";
import { openSkill } from "./runtime.ts";

test("Publish renders the two audience doors", async ({ page }) => {
  await openSkill(page, "fixture-maestro");
  await page.locator("main").getByRole("button", { name: "Publish", exact: true }).click();

  await expect(page.getByText("Publish to", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All my agents" })).toBeVisible();
  await expect(page.getByRole("button", { name: "This project's agents" })).toBeVisible();
});
