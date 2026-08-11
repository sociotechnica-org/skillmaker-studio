import { expect, test } from "@playwright/test";
import { emptyStudioUrl, studioUrl } from "./runtime.ts";

test("Board renders registered skills in their stage columns", async ({ page }) => {
  await page.goto(studioUrl());

  const board = page.locator("main");
  await expect(board.getByRole("heading", { name: "Board", exact: true })).toBeVisible();
  await expect(board.getByText("Evals", { exact: true }).first()).toBeVisible();
  await expect(board.getByRole("button", { name: /^fixture-maestro\b/ })).toBeVisible();
  await expect(board.getByText("Idea", { exact: true }).first()).toBeVisible();
  await expect(board.getByRole("button", { name: /^idea-compass\b/ })).toBeVisible();
});

test("an empty registry offers the first-project welcome", async ({ page }) => {
  await page.goto(emptyStudioUrl());

  await expect(page.getByRole("heading", { name: "Welcome to Skillmaker Studio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create your first project" })).toBeVisible();
});
