/**
 * THROWAWAY migration: legacy per-bundle files → `skill.json` schemaVersion 2
 * (THE MERGE, docs/proposals/2026-08-11-the-merge-skill-json.md + director
 * rulings 2026-08-11). Deliberately NOT a CLI command (pre-release ruling:
 * only this repo and a couple of repos we own need it — run it, review the
 * diff, delete it later).
 *
 * Usage:
 *   bun scripts/migrate-skill-json.ts <bundle-dir> [<bundle-dir>...] [--dry-run]
 *   bun scripts/migrate-skill-json.ts --all [<project-root>] [--dry-run]
 *
 * Per bundle (one bundle = one clean git diff):
 *   1. Reads bundle.json + root evals.json + evals/fixtures/*\/case.json +
 *      evals/risk-map.md (+ the journal, for the declared stage) — through
 *      the SHIPPED core readers (`parseEvalsJson`, `parseRiskMap`,
 *      `Journal` + `foldBundleStates`), never hand-rolled forks: migration
 *      deletes the originals after reading, so the read must be the real
 *      one — and builds skill.json:
 *        - `skill`  ← bundle.json (targets → harnesses) + declared stage
 *        - `design` ← evals.json failureHypotheses (proofSpecs → `cases`
 *          pointers; each proofSpec's setup/expectedBehavior moves onto the
 *          named case), falling back to risk-map.md rows when there is no
 *          evals.json; case.json `risks` edges are REVERSED onto the
 *          matching hypotheses (hypothesis→case is the only edge in v2)
 *        - `evals.cases` ← proofSpecs ∪ case dirs, merged with each
 *          case.json's {class, setup→sandbox, grading, source}
 *        - `publish.targets` ← bundle.json publishTargets, verbatim
 *        - NO stations section — the production line is code
 *   2. Renames evals/fixtures/ → evals/cases/ and each case's
 *      expected/answer-key.md → expected.md.
 *   3. Deletes bundle.json, evals.json, stations.json, evals/risk-map.md,
 *      and every per-case case.json (git is the undo).
 *
 * Idempotent: a bundle that already has skill.json is a no-op with a
 * message. `--dry-run` prints the plan without touching anything.
 *
 * The pure transform (`buildSkillJsonDocument`) lives in
 * packages/core/src/SkillJsonMigration.ts so it typechecks inside core's tsc
 * program (and its tests import it from there) — delete that module together
 * with this script after the real bundles migrate.
 */
import {
  buildSkillJsonDocument,
  foldBundleStates,
  Journal,
  JournalLayer,
  parseEvalsJson,
  parseRiskMap,
} from "@skillmaker/core";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import type { FileSystem } from "effect/FileSystem";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Runs one core reader with the real platform services. */
const runCore = <A, E>(effect: Effect.Effect<A, E, FileSystem>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(BunServices.layer)));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

// ---------------------------------------------------------------------------
// Impure driver — gather (through the core readers), plan, execute
// ---------------------------------------------------------------------------

interface PlannedAction {
  readonly kind: "write" | "rename" | "delete" | "rmdir";
  readonly path: string;
  readonly to?: string;
  readonly content?: string;
}

export interface BundleMigrationPlan {
  readonly bundleDir: string;
  readonly status: "already-migrated" | "no-bundle-json" | "ready";
  readonly actions: ReadonlyArray<PlannedAction>;
  readonly notes: ReadonlyArray<string>;
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

/** The declared stage: `foldBundleStates` over the project journal above `bundleDir` (found via skillmaker.config.json), default "idea" (applied by the transform). */
const readDeclaredStage = async (bundleDir: string, slug: string): Promise<string | undefined> => {
  let dir = resolve(bundleDir);
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, "skillmaker.config.json"))) break;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  const journalPath = join(dir, ".skillmaker", "events.jsonl");
  if (!existsSync(journalPath)) return undefined;
  const events = await Effect.runPromise(
    Effect.gen(function* () {
      const journal = yield* Journal;
      return yield* journal.readAll();
    }).pipe(Effect.provide(Layer.provide(JournalLayer(journalPath), BunServices.layer)), Effect.provide(BunServices.layer)),
  );
  return foldBundleStates(events).get(slug)?.stage;
};

export const planBundleMigration = async (bundleDirInput: string): Promise<BundleMigrationPlan> => {
  const bundleDir = resolve(bundleDirInput);
  if (existsSync(join(bundleDir, "skill.json"))) {
    return { bundleDir, status: "already-migrated", actions: [], notes: [] };
  }
  const bundleJsonPath = join(bundleDir, "bundle.json");
  const bundleJsonRaw = readJson(bundleJsonPath);
  if (!isRecord(bundleJsonRaw)) {
    return { bundleDir, status: "no-bundle-json", actions: [], notes: [] };
  }

  const fixturesDir = join(bundleDir, "evals", "fixtures");
  const casesDir = join(bundleDir, "evals", "cases");
  const materialsDir = existsSync(fixturesDir) ? fixturesDir : casesDir;

  const caseJsons = new Map<string, unknown>();
  const answerKeyFiles = new Set<string>();
  const caseDirs: string[] = [];
  if (existsSync(materialsDir)) {
    for (const entry of readdirSync(materialsDir).sort()) {
      if (entry.startsWith(".")) continue;
      const caseDir = join(materialsDir, entry);
      if (!statSync(caseDir).isDirectory()) continue;
      caseDirs.push(entry);
      const caseJsonPath = join(caseDir, "case.json");
      caseJsons.set(entry, existsSync(caseJsonPath) ? readJson(caseJsonPath) : undefined);
      if (existsSync(join(caseDir, "expected", "answer-key.md"))) {
        answerKeyFiles.add(entry);
      }
    }
  }

  // The SHIPPED tolerant readers gather the claims sources — the same code
  // paths the index reads through, so nothing weaker sits in front of the
  // deletions below.
  const evalsScan = await runCore(parseEvalsJson(join(bundleDir, "evals.json")));
  const riskMapPath = join(bundleDir, "evals", "risk-map.md");
  const riskMapScan = existsSync(riskMapPath) ? await runCore(parseRiskMap(riskMapPath)) : undefined;

  const slug = asString(bundleJsonRaw.slug) ?? basename(bundleDir);
  const { doc, notes } = buildSkillJsonDocument({
    bundleJson: bundleJsonRaw,
    ...(evalsScan.status === "parsed" ? { evalsHypotheses: evalsScan.hypotheses } : {}),
    ...(riskMapScan !== undefined ? { riskMapRows: riskMapScan.rows } : {}),
    caseJsons,
    stage: await readDeclaredStage(bundleDir, slug),
  });

  const actions: PlannedAction[] = [];
  actions.push({ kind: "write", path: join(bundleDir, "skill.json"), content: `${JSON.stringify(doc, null, 2)}\n` });
  if (existsSync(fixturesDir)) {
    actions.push({ kind: "rename", path: fixturesDir, to: casesDir });
  }
  for (const entry of caseDirs) {
    const newCaseDir = join(casesDir, entry);
    if (answerKeyFiles.has(entry)) {
      actions.push({
        kind: "rename",
        path: join(newCaseDir, "expected", "answer-key.md"),
        to: join(newCaseDir, "expected.md"),
      });
      actions.push({ kind: "rmdir", path: join(newCaseDir, "expected") });
    }
    if (caseJsons.get(entry) !== undefined || existsSync(join(materialsDir, entry, "case.json"))) {
      actions.push({ kind: "delete", path: join(newCaseDir, "case.json") });
    }
  }
  for (const legacy of ["bundle.json", "evals.json", "stations.json", join("evals", "risk-map.md")]) {
    if (existsSync(join(bundleDir, legacy))) {
      actions.push({ kind: "delete", path: join(bundleDir, legacy) });
    }
  }

  return { bundleDir, status: "ready", actions, notes };
};

export const executePlan = (plan: BundleMigrationPlan): void => {
  for (const action of plan.actions) {
    switch (action.kind) {
      case "write": {
        mkdirSync(dirname(action.path), { recursive: true });
        writeFileSync(action.path, action.content ?? "");
        break;
      }
      case "rename": {
        if (existsSync(action.path) && action.to !== undefined) {
          renameSync(action.path, action.to);
        }
        break;
      }
      case "delete": {
        if (existsSync(action.path)) {
          unlinkSync(action.path);
        }
        break;
      }
      case "rmdir": {
        try {
          rmdirSync(action.path); // only if empty — .gitkeep etc. keeps it, harmlessly
        } catch {
          // non-empty or already gone: fine
        }
        break;
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const describe = (plan: BundleMigrationPlan): string => {
  const lines: string[] = [`# ${plan.bundleDir}`];
  for (const action of plan.actions) {
    lines.push(
      action.kind === "rename" ? `  rename ${action.path} -> ${action.to}` : `  ${action.kind} ${action.path}`,
    );
  }
  for (const note of plan.notes) {
    lines.push(`  note: ${note}`);
  }
  return lines.join("\n");
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const all = args.includes("--all");
  const positional = args.filter((arg) => !arg.startsWith("--"));

  let bundleDirs: string[] = [];
  if (all) {
    const root = resolve(positional[0] ?? ".");
    const configPath = join(root, "skillmaker.config.json");
    if (!existsSync(configPath)) {
      console.error(`--all: no skillmaker.config.json at ${root}`);
      process.exit(2);
    }
    const config = readJson(configPath);
    const skillsDir = isRecord(config) && typeof config.skillsDir === "string" ? config.skillsDir : "skills";
    const skillsRoot = join(root, skillsDir);
    if (existsSync(skillsRoot)) {
      for (const entry of readdirSync(skillsRoot).sort()) {
        const dir = join(skillsRoot, entry);
        if (statSync(dir).isDirectory() && existsSync(join(dir, "bundle.json"))) {
          bundleDirs.push(dir);
        }
      }
    }
  } else {
    bundleDirs = positional;
  }

  if (bundleDirs.length === 0) {
    console.error(
      "usage: bun scripts/migrate-skill-json.ts <bundle-dir> [<bundle-dir>...] [--dry-run]\n" +
        "       bun scripts/migrate-skill-json.ts --all [<project-root>] [--dry-run]",
    );
    process.exit(2);
  }

  for (const dir of bundleDirs) {
    const plan = await planBundleMigration(dir);
    if (plan.status === "already-migrated") {
      console.log(`${plan.bundleDir}: already migrated (skill.json exists) — nothing to do`);
      continue;
    }
    if (plan.status === "no-bundle-json") {
      console.log(`${plan.bundleDir}: no readable bundle.json — skipped`);
      continue;
    }
    console.log(describe(plan));
    if (dryRun) {
      console.log("  (dry run — nothing written)");
      continue;
    }
    executePlan(plan);
    console.log(`  migrated.`);
  }
};

if (import.meta.main) {
  await main();
}
