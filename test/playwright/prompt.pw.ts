import { expect, test } from "@playwright/test";
import { openSkill } from "./runtime.ts";

test("Prompt renders the full SKILL.md and preserves ordered-list numbering", async ({ page }) => {
  await openSkill(page, "fixture-maestro");
  await page.getByRole("button", { name: "Prompt", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Fixture Maestro" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Full instructions" })).toBeVisible();
  const ordered = page.locator("main ol");
  await expect(ordered).toHaveAttribute("start", "3");
  await expect(ordered.getByRole("listitem")).toHaveText([
    "Inspect the registered project.",
    "Expand the fixture evidence.",
    "Keep the composer editable.",
  ]);
});
