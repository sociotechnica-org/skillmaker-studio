import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: ".",
  // A dedicated suffix keeps a literal `bun test` from collecting these
  // Playwright-only files; run them through the guarded root script.
  testMatch: "*.pw.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  outputDir: join(tmpdir(), "skillmaker-playwright-results"),
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
