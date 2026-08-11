import { expect, test } from "@playwright/test";
import { openSkill } from "./runtime.ts";

test("Research renders files and persists folds in localStorage", async ({ page }) => {
  await openSkill(page, "fixture-maestro");
  await page.getByRole("button", { name: "Research", exact: true }).click();

  const notes = page.locator("details").filter({ hasText: "notes.md" });
  const design = page.locator("details").filter({ hasText: "design.md" });
  const decisions = page.locator("details").filter({ hasText: "decisions.md" });
  await expect(notes).toHaveAttribute("open", "");
  await expect(design).toHaveAttribute("open", "");
  await expect(decisions).not.toHaveAttribute("open", "");
  await notes.locator("summary").click();
  await expect(notes).not.toHaveAttribute("open", "");
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("sm-research-folds-fixture-maestro")),
    )
    .toContain('"research/notes.md":false');

  await page.reload();
  await page.locator("main").getByRole("button", { name: /^fixture-maestro\b/ }).click();
  await page.getByRole("button", { name: "Research", exact: true }).click();
  await expect(page.locator("details").filter({ hasText: "notes.md" })).not.toHaveAttribute("open", "");
});
