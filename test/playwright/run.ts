import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const hasChromium = (value: unknown): value is { readonly chromium: { readonly executablePath: () => unknown } } => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || !("chromium" in value)) return false;
  const chromium = value.chromium;
  return (
    typeof chromium === "object" &&
    chromium !== null &&
    "executablePath" in chromium &&
    typeof chromium.executablePath === "function"
  );
};

let executablePath: string;
let cliPath: string;
try {
  const playwright: unknown = require("@playwright/test");
  if (!hasChromium(playwright)) throw new Error("@playwright/test did not expose Chromium");
  const candidate = playwright.chromium.executablePath();
  if (typeof candidate !== "string") throw new Error("Playwright returned an invalid Chromium path");
  executablePath = candidate;
  cliPath = require.resolve("@playwright/test/cli");
} catch (cause) {
  console.error("Skillmaker Playwright: @playwright/test is not installed. Run `bun install` first.");
  console.error(cause);
  process.exit(1);
}

if (!existsSync(executablePath)) {
  console.log(
    "Skillmaker Playwright: skipped -- Chromium is not installed. " +
      "Run `npx playwright install chromium`, then `bun run test:playwright`.",
  );
  process.exit(0);
}

const result = Bun.spawnSync(
  ["node", cliPath, "test", "--config", "test/playwright/playwright.config.ts"],
  { cwd: import.meta.dir + "/../..", stdout: "inherit", stderr: "inherit", env: process.env },
);
process.exit(result.exitCode);
