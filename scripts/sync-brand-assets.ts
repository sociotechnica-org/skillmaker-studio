#!/usr/bin/env bun
/**
 * Copies the canonical brand assets (assets/brand/) into each consuming
 * app's public/ directory.
 *
 * assets/brand/ is the single source of truth; the public/ copies are
 * generated and gitignored. This runs automatically before each app's
 * dev/build (see the `sync:brand` step in the relevant package.json), so
 * a change to a canonical asset propagates everywhere on the next run --
 * no hand-copying, no drift.
 *
 * To add a new consumer (e.g. the marketing-site once its wordmark lands),
 * add its public/ path to the asset's `dests` below and prepend
 * `bun run sync:brand &&` to that package's dev/build scripts.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const brandDir = join(repoRoot, "assets", "brand");

/** Each canonical asset -> the app public/ paths (repo-relative) that consume it. */
const ASSETS: ReadonlyArray<{ src: string; dests: readonly string[] }> = [
  {
    src: "skillmaker-logo.png",
    dests: [
      "packages/viewer/public/skillmaker-logo.png",
      // The marketing-site adopts the hand-drawn wordmark on its own branch;
      // uncomment (and wire its build) when that lands:
      // "packages/marketing-site/public/skillmaker-logo.png",
    ],
  },
];

let copied = 0;
for (const asset of ASSETS) {
  const from = join(brandDir, asset.src);
  if (!existsSync(from)) {
    throw new Error(`brand asset missing: ${from} (expected under assets/brand/)`);
  }
  for (const rel of asset.dests) {
    const to = join(repoRoot, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    copied += 1;
    console.log(`brand: ${asset.src} -> ${rel}`);
  }
}
console.log(`brand: synced ${copied} file(s) from assets/brand/`);
