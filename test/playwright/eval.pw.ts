import { expect, test } from "@playwright/test";
import { openSkill } from "./runtime.ts";

test("runnable Eval shows claims, completed evidence, and expandable fixture bodies", async ({ page }) => {
  await openSkill(page, "fixture-maestro");
  await page.getByRole("button", { name: "Eval", exact: true }).click();

  await expect(page.getByText("The viewer hides the authored fixture prompt.")).toBeVisible();
  await page.getByRole("button", { name: /1 fixture · expand/ }).click();
  await expect(page.getByText("visible-evidence", { exact: true })).toBeVisible();
  await expect(page.getByText("pass", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "view fixture ▸" }).click();
  // The prompt text renders twice: the fixture's faded one-line summary and
  // the expanded body panel. `.last()` is the body opened by the click above.
  await expect(page.getByText("Explain why deterministic browser tests should avoid arbitrary sleeps.").last()).toBeVisible();
  await expect(page.getByText("Playwright auto-waits on observable UI state.")).toBeVisible();
});

test("Idea-stage Eval is read-only with planned labels and no run controls", async ({ page }) => {
  await openSkill(page, "idea-compass");
  await page.getByRole("button", { name: "Eval", exact: true }).click();

  await expect(page.getByText("Authored during design — runnable once a draft exists.")).toBeVisible();
  await expect(page.getByText("An ambiguous request reaches the future prompt unchanged.")).toBeVisible();
  await expect(page.getByText(/ambiguous-request/)).toBeVisible();
  await expect(page.getByText("(planned)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Run/ })).toHaveCount(0);
});
