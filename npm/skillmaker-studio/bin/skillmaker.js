#!/usr/bin/env node
// Launcher for the `skillmaker-studio` wrapper package
// (docs/proposals/2026-07-20-install-simplification.md Phase A.3).
//
// This is the ENTIRE runtime logic of the wrapper: resolve which
// `@skillmaker/cli-<platform>-<arch>` optionalDependency npm actually
// installed for this machine, then spawn its compiled binary with the
// user's argv, inheriting stdio and forwarding the exit code. No
// postinstall script, no network access, no runtime download -- the binary
// is already on disk because npm installed the matching optionalDependency
// (or didn't, if the platform is unsupported, in which case we say so and
// exit non-zero rather than hanging).
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const PLATFORM_PACKAGES = {
  "darwin-arm64": "@skillmaker/cli-darwin-arm64",
  "linux-x64": "@skillmaker/cli-linux-x64",
};

function resolvePlatformBinary() {
  const key = `${process.platform}-${process.arch}`;
  const packageName = PLATFORM_PACKAGES[key];
  if (packageName === undefined) {
    const supported = Object.keys(PLATFORM_PACKAGES).join(", ");
    throw new Error(
      `skillmaker-studio: no build for ${key}. Supported platforms: ${supported}.\n` +
        `If you believe this platform should be supported, please open an issue at\n` +
        `https://github.com/sociotechnica-org/skillmaker-studio/issues.`,
    );
  }

  let packageJsonPath;
  try {
    packageJsonPath = require.resolve(`${packageName}/package.json`);
  } catch (_err) {
    throw new Error(
      `skillmaker-studio: couldn't find ${packageName} (npm should have installed it\n` +
        `automatically as an optionalDependency matching your platform). Try\n` +
        `reinstalling with "npm install skillmaker-studio" and check for npm warnings\n` +
        `about skipped optional dependencies.`,
    );
  }

  return path.join(path.dirname(packageJsonPath), "bin", "skillmaker");
}

function main() {
  const binaryPath = resolvePlatformBinary();
  const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" });

  if (result.error !== undefined && result.error !== null) {
    throw result.error;
  }

  process.exit(result.status === null ? 1 : result.status);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
