/**
 * End-to-end: `skillmaker adopt` (brownfield import,
 * strategy-skills-repo-mode.md §3B, plan.md Phase 16) against a synthetic
 * brownfield repo built in a scratch dir that reproduces the shapes of the
 * four verified target repos (docs/research/2026-07-11-competitive-scan/
 * target-repos-brownfield.md):
 *
 *  - gstack: flat `<name>/SKILL.md` at repo root, plus a `.tmpl` source +
 *    AUTO-GENERATED `SKILL.md` pair
 *  - mattpocock/skills: `skills/<category>/<name>/SKILL.md`, including a
 *    `skills/deprecated/<name>/SKILL.md` and a nonstandard
 *    `disable-model-invocation` frontmatter key
 *  - EveryInc/compound-engineering-plugin: `skills/<name>/SKILL.md` +
 *    `references/` + `scripts/`, alongside a `.claude-plugin/plugin.json`
 *    manifest
 *  - elicit/claude-config: `.agents/skills/<name>/SKILL.md` with a sidecar
 *    `.sh` installer script
 *
 * Drives `init` -> `adopt` -> `list`/`reindex` through the real CLI (spawned
 * as a subprocess, matching test/e2e/phase2.e2e.test.ts's pattern), then
 * asserts on the adopt report, the on-disk markers, the journal, and the
 * catalog/index. Also proves a second `adopt` run is a no-op.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const write = (relativePath: string, content: string): void => {
  const full = join(scratchDir, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
};

interface AdoptedView {
  readonly slug: string;
  readonly path: string;
  readonly lifecycle: string;
  readonly generated: boolean;
  readonly warnings: ReadonlyArray<string>;
}

interface ManifestView {
  readonly relativePath: string;
  readonly kind: string;
}

interface EvalInfraView {
  readonly relativePath: string;
  readonly kind: string;
}

interface AdoptReportView {
  readonly found: number;
  readonly adopted: ReadonlyArray<AdoptedView>;
  readonly skipped: ReadonlyArray<{ relativePath: string; reason: string }>;
  readonly warnings: ReadonlyArray<string>;
  readonly manifests: ReadonlyArray<ManifestView>;
  readonly evalInfra: ReadonlyArray<EvalInfraView>;
}

interface BundleView {
  readonly slug: string;
  readonly stage: string;
  readonly archived: boolean;
}

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase16-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    cpSync(toolVersions, join(scratchDir, ".tool-versions"));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  // -- gstack shape: flat <name>/SKILL.md at repo root -----------------------
  write(
    "browse/SKILL.md",
    `---
name: browse
description: browse the web with a headless session
---
# browse

Body.
`,
  );

  // gstack shape: a generated SKILL.md alongside its .tmpl source.
  write(
    "deploy/SKILL.md",
    `<!-- AUTO-GENERATED from SKILL.md.tmpl -- do not edit by hand -->
---
name: deploy
description: deploy the app
version: 2.1.0
---
# deploy
`,
  );
  write("deploy/SKILL.md.tmpl", "---\nname: deploy\n---\n# deploy (template source)\n");

  // -- mattpocock/skills shape: skills/<category>/<name>/SKILL.md -----------
  write(
    "skills/engineering/diagnosing-bugs/SKILL.md",
    `---
name: diagnosing-bugs
description: systematically diagnose a bug report
disable-model-invocation: true
---
# diagnosing-bugs
`,
  );
  write(
    "skills/deprecated/old-review-flow/SKILL.md",
    `---
name: old-review-flow
description: superseded review flow
---
# old-review-flow
`,
  );
  write(
    "skills/in-progress/half-baked-idea/SKILL.md",
    `---
name: half-baked-idea
description: not ready yet
---
# half-baked-idea
`,
  );

  // -- EveryInc shape: skills/<name>/ + references/ + scripts/, plus a
  // .claude-plugin/plugin.json manifest sitting alongside.
  write(
    "skills/writing-prs/SKILL.md",
    `---
name: writing-prs
description: write a clean pull request description
---
# writing-prs
`,
  );
  write("skills/writing-prs/references/style-guide.md", "# Style guide\n");
  write("skills/writing-prs/scripts/format.sh", "#!/bin/sh\necho format\n");
  write(".claude-plugin/plugin.json", JSON.stringify({ name: "compound-engineering", skills: ["writing-prs"] }));

  // -- elicit shape: .agents/skills/<name>/ with a sidecar installer --------
  write(
    ".agents/skills/aikido/SKILL.md",
    `---
name: aikido
description: aikido-style conflict de-escalation
---
# aikido
`,
  );
  write(".agents/skills/aikido/install.sh", "#!/bin/sh\necho install\n");

  // Report-only eval/test infra, unrelated to any one skill.
  write("evals/golden-cases.yml", "cases: []\n");
  write("tests/smoke.test.ts", "test();\n");
});

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("skillmaker CLI end-to-end: Phase 16 (adopt -- brownfield import)", () => {
  test("adopt without an existing workspace errors with a hint", () => {
    const result = runCli(["adopt"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("skillmaker init");
  });

  test(
    "init",
    () => {
      expect(runCli(["init", "--json"]).exitCode).toBe(0);
    },
    20000,
  );

  test(
    "adopt discovers and wraps all four brownfield shapes",
    () => {
      const result = runCli(["adopt", "--json"]);
      expect(result.exitCode).toBe(0);
      const report = JSON.parse(result.stdout) as AdoptReportView;

      expect(report.found).toBe(7);
      expect(report.skipped.length).toBe(0);

      const slugs = report.adopted.map((s) => s.slug).sort();
      expect(slugs).toEqual([
        "aikido",
        "browse",
        "deploy",
        "diagnosing-bugs",
        "half-baked-idea",
        "old-review-flow",
        "writing-prs",
      ]);

      const bySlug = new Map(report.adopted.map((s) => [s.slug, s]));

      // gstack: generated SKILL.md flagged.
      expect(bySlug.get("deploy")?.generated).toBe(true);
      expect(bySlug.get("deploy")?.warnings.some((w) => w.toLowerCase().includes("generated"))).toBe(true);
      expect(bySlug.get("browse")?.generated).toBe(false);

      // mattpocock: nonstandard frontmatter key preserved + warned, and
      // lifecycle inferred from deprecated/ and in-progress/ pathnames.
      expect(
        bySlug
          .get("diagnosing-bugs")
          ?.warnings.some((w) => w.includes("disable-model-invocation")),
      ).toBe(true);
      expect(bySlug.get("old-review-flow")?.lifecycle).toBe("deprecated");
      expect(bySlug.get("half-baked-idea")?.lifecycle).toBe("in-progress");
      expect(bySlug.get("half-baked-idea")?.warnings.some((w) => w.includes("in-progress"))).toBe(true);

      // EveryInc: manifest detected report-only.
      expect(report.manifests.some((m) => m.relativePath.includes("plugin.json"))).toBe(true);

      // eval/test infra detected report-only.
      const infraKinds = report.evalInfra.map((e) => e.kind).sort();
      expect(infraKinds).toEqual(["evals", "tests"]);
    },
    20000,
  );

  test("markers and bundle.json were written in place, not moved", () => {
    expect(existsSync(join(scratchDir, "browse", "bundle.json"))).toBe(true);
    expect(existsSync(join(scratchDir, "browse", ".skillmaker-adopt.json"))).toBe(true);
    expect(existsSync(join(scratchDir, "browse", "SKILL.md"))).toBe(true);

    expect(existsSync(join(scratchDir, "skills", "engineering", "diagnosing-bugs", "bundle.json"))).toBe(true);
    expect(existsSync(join(scratchDir, ".agents", "skills", "aikido", "bundle.json"))).toBe(true);
    expect(existsSync(join(scratchDir, ".agents", "skills", "aikido", "install.sh"))).toBe(true);

    const marker = JSON.parse(
      readFileSync(join(scratchDir, "deploy", ".skillmaker-adopt.json"), "utf8"),
    ) as { layout: string; generated: boolean; frontmatter: Record<string, unknown> };
    expect(marker.layout).toBe("in-place");
    expect(marker.generated).toBe(true);
    expect(marker.frontmatter["version"]).toBe("2.1.0");

    // The EveryInc manifest was left untouched (report-only, not written to).
    const manifest = JSON.parse(readFileSync(join(scratchDir, ".claude-plugin", "plugin.json"), "utf8")) as {
      name: string;
    };
    expect(manifest.name).toBe("compound-engineering");
  });

  test("journal recorded bundle.created (+ bundle.archived for the deprecated skill) and skill.version_recorded", () => {
    const journalPath = join(scratchDir, ".skillmaker", "events.jsonl");
    const lines = readFileSync(journalPath, "utf8").trim().split("\n").filter((line) => line.length > 0);
    const events = lines.map((line) => JSON.parse(line) as { type: string; payload: { bundle?: string } });

    const createdSlugs = events.filter((e) => e.type === "bundle.created").map((e) => e.payload.bundle);
    expect(createdSlugs).toContain("old-review-flow");
    expect(createdSlugs).toContain("browse");

    const archivedSlugs = events.filter((e) => e.type === "bundle.archived").map((e) => e.payload.bundle);
    expect(archivedSlugs).toEqual(["old-review-flow"]);

    const versionRecordedSlugs = events
      .filter((e) => e.type === "skill.version_recorded")
      .map((e) => e.payload.bundle);
    expect(versionRecordedSlugs.sort()).toEqual(
      [
        "aikido",
        "browse",
        "deploy",
        "diagnosing-bugs",
        "half-baked-idea",
        "old-review-flow",
        "writing-prs",
      ].sort(),
    );
  });

  test("the catalog (list) surfaces every adopted skill, and old-review-flow shows archived", () => {
    const result = runCli(["list", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { bundles: ReadonlyArray<BundleView> };
    const slugs = parsed.bundles.map((b) => b.slug).sort();
    expect(slugs).toEqual(
      [
        "aikido",
        "browse",
        "deploy",
        "diagnosing-bugs",
        "half-baked-idea",
        "old-review-flow",
        "writing-prs",
      ].sort(),
    );

    const byS = new Map(parsed.bundles.map((b) => [b.slug, b]));
    expect(byS.get("old-review-flow")?.archived).toBe(true);
    expect(byS.get("browse")?.archived).toBe(false);
  });

  test("reindex hashes every in-place bundle without error (rebuildability proof)", () => {
    const dbPath = join(scratchDir, ".skillmaker", "studio.db");
    if (existsSync(dbPath)) {
      rmSync(dbPath);
    }
    const result = runCli(["reindex", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; bundles: number; warnings: ReadonlyArray<string> };
    expect(parsed.status).toBe("reindexed");
    expect(parsed.bundles).toBe(7);
    expect(parsed.warnings).toEqual([]);
  });

  test("a second adopt run is a no-op: 0 newly adopted, everything already-adopted", () => {
    const result = runCli(["adopt", "--json"]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as AdoptReportView;
    expect(report.found).toBe(7);
    expect(report.adopted.length).toBe(0);
    expect(report.skipped.length).toBe(7);
  });

  test("a newly appeared SKILL.md after re-adopt is picked up on top of the rest", () => {
    write(
      "skills/productivity/note-taking/SKILL.md",
      `---
name: note-taking
description: capture notes fast
---
# note-taking
`,
    );

    const result = runCli(["adopt", "--json"]);
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout) as AdoptReportView;
    expect(report.found).toBe(8);
    expect(report.adopted.map((s) => s.slug)).toEqual(["note-taking"]);
    expect(report.skipped.length).toBe(7);
  });
});
