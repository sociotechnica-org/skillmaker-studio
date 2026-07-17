/**
 * End-to-end: `skillmaker adopt --triage` / `adopt --from-manifest`, and the
 * registry/paperwork tripwire on plain `adopt` (issue #92, `Mechanism -
 * Receiving Dock.md` §HOW: "Bulk import is the same tree as a triage
 * manifest"). Same harness as `receive.e2e.test.ts`: scaffold a workspace
 * with one recorded bundle, seed a mixed directory (a bare skill, a
 * byte-identical copy of the recorded bundle's output, and a same-name
 * stranger with different content) -> `adopt` over it challenges the two
 * evidence-bearing candidates instead of silently stamping them -> `adopt
 * --triage` over a second copy of the same mix writes a manifest whose
 * pre-fills match that same evidence -> hand-edit the manifest
 * programmatically -> `adopt --from-manifest` executes it, asserting
 * adopted/received/archived/skipped outcomes and an intake-origin todo.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let recordedSkillMdContent: string;

const runCli = (args: ReadonlyArray<string>, cwd: string = scratchDir) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const journalPath = () => join(scratchDir, ".skillmaker", "events.jsonl");

const journalEvents = (): ReadonlyArray<{
  readonly type: string;
  readonly payload: Record<string, unknown>;
}> =>
  readFileSync(journalPath(), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

const seedMixedDirectory = (root: string, suffix: string) => {
  const bareDir = join(root, `bare-skill-${suffix}`);
  mkdirSync(bareDir, { recursive: true });
  writeFileSync(
    join(bareDir, "SKILL.md"),
    `---\nname: bare-skill-${suffix}\ndescription: a brand-new skill with no overlap.\n---\n\nDo the new thing.\n`,
  );

  const copyDir = join(root, `copy-of-recorded-${suffix}`);
  mkdirSync(copyDir, { recursive: true });
  writeFileSync(join(copyDir, "SKILL.md"), recordedSkillMdContent);

  const strangerDir = join(root, `name-collision-${suffix}`);
  mkdirSync(strangerDir, { recursive: true });
  writeFileSync(
    join(strangerDir, "SKILL.md"),
    "---\nname: demo-skill\ndescription: a completely different implementation.\n---\n\nDo a different thing entirely.\n",
  );

  return { bareDir, copyDir, strangerDir };
};

/** Splits `| a | b | c |` into `["a", "b", "c"]` -- mirrors `Triage.ts`'s own tolerant table-cell split. */
const splitRowCells = (line: string): string[] => {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
};

const MANIFEST_COLUMNS = [
  "name",
  "path",
  "mechanicalCondition",
  "evidence",
  "decision",
  "whose",
  "rights",
  "stakes",
  "hurts",
  "priority",
  "maturity",
] as const;

/**
 * Rewrites one manifest row (found by its exact Path cell) with a partial
 * set of column overrides, reconstructing the full `| a | b | ... |` line --
 * avoids fragile whole-line regexes over a table format only loosely
 * specified by this test.
 */
const editManifestRow = (
  content: string,
  path: string,
  overrides: Partial<Record<(typeof MANIFEST_COLUMNS)[number], string>>,
): string => {
  const lines = content.split("\n");
  const index = lines.findIndex((line) => {
    if (!line.trim().startsWith("|")) return false;
    const cells = splitRowCells(line);
    return cells[1] === path;
  });
  if (index === -1) {
    throw new Error(`editManifestRow: no row found with Path "${path}"`);
  }
  const cells = splitRowCells(lines[index]!);
  const updated = MANIFEST_COLUMNS.map((column, i) => overrides[column] ?? cells[i] ?? "");
  lines[index] = `| ${updated.join(" | ")} |`;
  return lines.join("\n");
};

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-adopt-triage-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "demo-skill", "--json"]).exitCode).toBe(0);

  const bundleDir = join(scratchDir, "skills", "demo-skill");
  writeFileSync(join(bundleDir, "design.md"), "# Demo Skill\n\nA demo skill for the adopt-triage e2e suite.\n");
  recordedSkillMdContent =
    "---\nname: demo-skill\ndescription: a demo skill for the adopt-triage e2e suite.\n---\n\nDo the demo thing.\n";
  writeFileSync(join(bundleDir, "output", "SKILL.md"), recordedSkillMdContent);

  const versionResult = runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]);
  expect(versionResult.exitCode).toBe(0);
});

afterAll(() => {
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("skillmaker adopt: the registry/paperwork tripwire challenges provable arrivals", () => {
  test("a bare candidate adopts normally; a hash-match and a name-collision are challenged, not adopted", () => {
    seedMixedDirectory(join(scratchDir, "mixed-plain"), "plain");

    const result = runCli(["adopt", "mixed-plain", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as {
      found: number;
      adopted: ReadonlyArray<{ slug: string; path: string }>;
      challenged: ReadonlyArray<{ path: string; evidence: { kind: string; bundle?: string } }>;
    };

    expect(json.found).toBe(3);
    expect(json.adopted).toHaveLength(1);
    expect(json.adopted[0]?.path).toContain("bare-skill-plain");

    expect(json.challenged).toHaveLength(2);
    // Plain `adopt <path>`'s report paths are relative to the swept
    // subdirectory itself (pre-existing behavior, unaffected by the
    // tripwire) -- unlike `--triage`'s manifest rows, which anchor to the
    // workspace root so `--from-manifest` can resolve them later.
    const byPath = Object.fromEntries(json.challenged.map((c) => [c.path, c.evidence]));
    expect(byPath["copy-of-recorded-plain"]).toEqual({ kind: "hash-match", bundle: "demo-skill" });
    expect(byPath["name-collision-plain"]).toEqual({ kind: "name-collision", bundle: "demo-skill" });

    // Never silently adopted: no bundle.json written for either challenged candidate.
    expect(existsSync(join(scratchDir, "mixed-plain", "copy-of-recorded-plain", "bundle.json"))).toBe(false);
    expect(existsSync(join(scratchDir, "mixed-plain", "name-collision-plain", "bundle.json"))).toBe(false);
    expect(existsSync(join(scratchDir, "mixed-plain", "bare-skill-plain", "bundle.json"))).toBe(true);
  });
});

describe("skillmaker adopt --triage / --from-manifest: the bulk elicitation tree", () => {
  let manifestPath: string;
  const bareRowPath = "mixed-triage/bare-skill-triage";
  const copyRowPath = "mixed-triage/copy-of-recorded-triage";
  const collisionRowPath = "mixed-triage/name-collision-triage";

  test("--triage acts on nothing and pre-fills the manifest with matching evidence", () => {
    seedMixedDirectory(join(scratchDir, "mixed-triage"), "triage");

    const before = journalEvents().length;
    const result = runCli(["adopt", "--triage", "mixed-triage", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { manifest: string; rows: number };
    manifestPath = json.manifest;
    expect(json.rows).toBe(3);
    expect(existsSync(manifestPath)).toBe(true);

    // Acts on nothing: no journal event appended, no bundle.json written.
    expect(journalEvents().length).toBe(before);
    expect(existsSync(join(scratchDir, "mixed-triage", "bare-skill-triage", "bundle.json"))).toBe(false);

    const manifestContent = readFileSync(manifestPath, "utf8");
    const lines = manifestContent.split("\n").filter((line) => line.trim().startsWith("|"));
    const rowFor = (path: string) => {
      const line = lines.find((l) => splitRowCells(l)[1] === path);
      expect(line).toBeDefined();
      return splitRowCells(line!);
    };

    const bareRow = rowFor(bareRowPath);
    expect(bareRow).toEqual([
      "bare-skill-triage",
      bareRowPath,
      "parses, complete, no evals",
      "bare",
      "keep",
      "mine",
      "",
      "",
      "",
      "",
      "idea",
    ]);

    const copyRow = rowFor(copyRowPath);
    expect(copyRow[3]).toBe("hash matches recorded version demo-skill");
    expect(copyRow.slice(4)).toEqual(["keep", "receive", "", "", "", "", "idea"]);

    const collisionRow = rowFor(collisionRowPath);
    expect(collisionRow[0]).toBe("demo-skill"); // claimed name, from its own frontmatter
    expect(collisionRow[3]).toBe("name collides with bundle demo-skill");
    expect(collisionRow.slice(4)).toEqual(["keep", "receive", "", "", "", "", "idea"]);
  });

  test("--from-manifest executes the hand-edited rows as individual acts", () => {
    let content = readFileSync(manifestPath, "utf8");

    // bare-skill-triage: keep it as a working import (entry stage past idea) with a hurts note.
    content = editManifestRow(content, bareRowPath, {
      stakes: "load-bearing",
      hurts: "needs a rename before shipping",
      priority: "8",
      maturity: "working",
    });
    // copy-of-recorded-triage: leave the "receive" default -- it's ours coming home.
    // name-collision-triage: an explicit human call to archive it instead of docking it.
    content = editManifestRow(content, collisionRowPath, { decision: "archive", whose: "mine" });
    writeFileSync(manifestPath, content);

    const result = runCli(["adopt", "--from-manifest", manifestPath, "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as {
      adopted: number;
      received: number;
      archived: number;
      skipped: number;
      errored: number;
      todosMinted: number;
      outcomes: ReadonlyArray<{ kind: string; path: string; slug?: string; intake?: string; verdict?: string }>;
    };

    expect(json.adopted).toBe(1);
    expect(json.received).toBe(1);
    expect(json.archived).toBe(1);
    expect(json.errored).toBe(0);
    expect(json.todosMinted).toBe(1);

    const adoptedOutcome = json.outcomes.find((o) => o.kind === "adopted");
    expect(adoptedOutcome?.path).toBe(bareRowPath);

    const receivedOutcome = json.outcomes.find((o) => o.kind === "received");
    expect(receivedOutcome?.path).toBe(copyRowPath);
    expect(receivedOutcome?.verdict).toBe("return");

    const archivedOutcome = json.outcomes.find((o) => o.kind === "archived");
    expect(archivedOutcome?.path).toBe(collisionRowPath);

    // The intake-origin todo, minted from the working-import row's "hurts".
    const events = journalEvents();
    const todoOpened = events.filter((e) => e.type === "todo.opened");
    const intakeTodo = todoOpened.find(
      (e) => (e.payload.todo as { title: string }).title === "needs a rename before shipping",
    );
    expect(intakeTodo).toBeDefined();
    const todo = intakeTodo?.payload.todo as {
      origin: { kind: string; intakeId: string };
      priority: number;
      bundle?: string;
    };
    expect(todo.origin.kind).toBe("intake");
    expect(todo.priority).toBe(8);
    expect(todo.bundle).toBe(adoptedOutcome?.slug);

    // The working-import stage move is recorded honestly.
    const stageChange = events.find(
      (e) => e.type === "bundle.stage_changed" && e.payload.bundle === adoptedOutcome?.slug,
    );
    expect(stageChange?.payload).toMatchObject({
      reason: "triage: working import",
      override: true,
      to: "evaluating",
    });
  });

  test("--from-manifest is idempotent: re-running the same manifest skips the already-adopted rows and never re-receives the dock crate twice for that row", () => {
    const before = journalEvents().filter((e) => e.type === "skill.received").length;
    const result = runCli(["adopt", "--from-manifest", manifestPath, "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { adopted: number; archived: number; skipped: number };
    // The adopted/archived rows already hold bundle.json -- skipped this time.
    expect(json.adopted).toBe(0);
    expect(json.archived).toBe(0);
    expect(json.skipped).toBe(2);
    // The received row has no identity to check against, so `receiveCrate`
    // runs again -- a second, distinct dock arrival is correct per the
    // dock's own "no idempotency key" rule, not a bug in this manifest.
    const after = journalEvents().filter((e) => e.type === "skill.received").length;
    expect(after).toBe(before + 1);
  });

  test("plain adopt over the mixed-triage directory: the adopted/archived rows are now identified and skipped, but the received row's own source directory -- untouched by receive, per the dock's 'copy, never move' rule -- still hash-matches and is still (rightly) challenged, forever, until a human grants it identity", () => {
    const result = runCli(["adopt", "mixed-triage", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as {
      adopted: unknown[];
      challenged: ReadonlyArray<{ path: string; evidence: { kind: string; bundle?: string } }>;
      skipped: ReadonlyArray<{ relativePath: string }>;
    };
    expect(json.adopted).toEqual([]);
    expect(json.skipped.map((s) => s.relativePath).sort()).toEqual(["bare-skill-triage", "name-collision-triage"]);
    expect(json.challenged).toEqual([
      { path: "copy-of-recorded-triage", evidence: { kind: "hash-match", bundle: "demo-skill" } },
    ]);
  });
});
