const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} was not set by Playwright global setup`);
  }
  return value;
};

export const studioUrl = (): string => requiredEnv("SKILLMAKER_PLAYWRIGHT_URL");
export const emptyStudioUrl = (): string => requiredEnv("SKILLMAKER_PLAYWRIGHT_EMPTY_URL");

export const openSkill = async (
  page: import("@playwright/test").Page,
  slug: "fixture-maestro" | "idea-compass",
): Promise<void> => {
  await page.goto(studioUrl());
  await page.getByRole("heading", { name: "Board", exact: true }).waitFor();
  // The sidebar lists the same skill; the Board card lives in <main>.
  await page.locator("main").getByRole("button", { name: new RegExp(`^${slug}\\b`) }).click();
  await page.locator("main").getByRole("button", { name: "Overview", exact: true }).waitFor();
};
