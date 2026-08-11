/**
 * D6 (docs/proposals/2026-07-21-simplification.md): "William and a starter
 * set of research/drafting skills ship inside the product." The packaged
 * copies under `packages/cli/skills/` are checked in (so `bun src/main.ts`
 * dev use and the compiled binary both ship them with zero build magic),
 * with the repo's own self-hosted `skills/` workspace as the single source
 * of truth -- the drift test below is what keeps the copies honest: edit
 * William in `skills/`, re-copy into `packages/cli/skills/`, or this fails.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_STATIONS_TEMPLATE } from "@skillmaker/core";
import { locatePackagedSkillsDir } from "../src/PackagedSkills.ts";

/** The monorepo root (this file lives at packages/cli/test/). */
const repoRoot = join(import.meta.dir, "..", "..", "..");
const packagedRoot = join(repoRoot, "packages", "cli", "skills");
const workspaceRoot = join(repoRoot, "skills");

/** Every skill the default stations template references must ship packaged -- otherwise a fresh workspace's stations fail out of the box, which is exactly what D6 removed. */
const stationSkillSlugs = [
  ...new Set(
    Object.values(DEFAULT_STATIONS_TEMPLATE.stations)
      .map((station) => station.skill)
      .filter((skill): skill is string => skill !== undefined),
  ),
];

describe("packaged station skills (packages/cli/skills)", () => {
  test("the default stations template's skills are all packaged", () => {
    expect(stationSkillSlugs.length).toBeGreaterThan(0);
    for (const slug of stationSkillSlugs) {
      // skill.json is the schemaVersion-2 bundle marker (THE MERGE, 2026-08-11).
      expect(existsSync(join(packagedRoot, slug, "skill.json"))).toBe(true);
      expect(existsSync(join(packagedRoot, slug, "output", "SKILL.md"))).toBe(true);
    }
  });

  test("packaged copies match the workspace originals byte for byte (no silent drift)", () => {
    for (const slug of stationSkillSlugs) {
      for (const relPath of ["skill.json", "design.md", join("output", "SKILL.md")]) {
        const original = join(workspaceRoot, slug, relPath);
        const packaged = join(packagedRoot, slug, relPath);
        expect(existsSync(original)).toBe(true);
        expect(existsSync(packaged)).toBe(true);
        expect(readFileSync(packaged, "utf8")).toBe(readFileSync(original, "utf8"));
      }
    }
  });
});

describe("locatePackagedSkillsDir", () => {
  test("resolves packages/cli/skills from inside the monorepo checkout", () => {
    expect(locatePackagedSkillsDir(import.meta.url)).toBe(packagedRoot);
  });

  test("resolves a `packaged-skills` sibling of the executable (compiled-binary layout)", () => {
    // Simulate the dist layout: a fake execPath whose directory has a
    // `packaged-skills/` sibling, and a module URL that resolves nothing --
    // mirrors the virtual /$bunfs/ path inside a compiled binary, where only
    // the execPath walk can succeed.
    const fakeDist = mkdtempSync(join(tmpdir(), "skillmaker-packagedskills-test-"));
    try {
      mkdirSync(join(fakeDist, "packaged-skills"), { recursive: true });
      expect(
        locatePackagedSkillsDir("file:///nonexistent/virtual/module.ts", join(fakeDist, "skillmaker")),
      ).toBe(join(fakeDist, "packaged-skills"));
    } finally {
      rmSync(fakeDist, { recursive: true, force: true });
    }
  });

  test("returns undefined (never throws) when neither walk finds anything", () => {
    // Anchor both walks in an isolated temp tree so nothing up the real
    // filesystem can accidentally match.
    const empty = mkdtempSync(join(tmpdir(), "skillmaker-packagedskills-empty-"));
    try {
      // tmpdir ancestors could theoretically contain a `packaged-skills`
      // dir, but a `packages/cli/skills` OR `packaged-skills` under /tmp
      // ancestry would be somebody deliberately sabotaging their own box.
      expect(
        locatePackagedSkillsDir(`file://${join(empty, "module.ts")}`, join(empty, "bin", "skillmaker")),
      ).toBeUndefined();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
