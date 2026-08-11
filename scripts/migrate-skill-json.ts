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
 * The pure transform (`buildSkillJsonDocument`) is exported for tests.
 */
import {
  foldBundleStates,
  Journal,
  JournalLayer,
  parseEvalsJson,
  parseRiskMap,
  type EvalsFailureHypothesis,
  type RiskRow,
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

// ---------------------------------------------------------------------------
// The pure transform
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const stringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** Everything the pure transform consumes — outputs of the SHIPPED core readers plus raw case.json objects, no I/O. */
export interface LegacyBundleSnapshot {
  /** Parsed bundle.json (raw object — unknown fields noted, not carried). */
  readonly bundleJson: Record<string, unknown>;
  /** `parseEvalsJson`'s hypotheses, when the root evals.json parsed. */
  readonly evalsHypotheses?: ReadonlyArray<EvalsFailureHypothesis>;
  /** `parseRiskMap`'s rows, when evals/risk-map.md exists (the claims fallback). Coverage is dropped on purpose — it's DERIVED in v2. */
  readonly riskMapRows?: ReadonlyArray<Pick<RiskRow, "riskId" | "description" | "fixtureCase">>;
  /** `evals/fixtures/<dir>/case.json` contents by directory name (undefined value = dir without a case.json). */
  readonly caseJsons: ReadonlyMap<string, unknown>;
  /** Declared stage folded from the journal; defaults to "idea". */
  readonly stage?: string;
}

export interface BuildResult {
  /** The skill.json document, ready to stringify. */
  readonly doc: Record<string, unknown>;
  /** Human-readable notes about judgment calls the transform made. */
  readonly notes: ReadonlyArray<string>;
}

interface MutableHypothesis {
  id: string;
  failure: string;
  probability?: string;
  impact?: string;
  mustNever?: string;
  cases: string[];
}

interface MutableCase {
  name: string;
  class?: string;
  setup?: string;
  expectedBehavior?: string;
  expected?: string;
  checks?: ReadonlyArray<string>;
  sandbox?: Record<string, unknown>;
  source?: unknown;
}

/** The one legacy answer-key path that becomes the v2 default `expected.md`. */
const LEGACY_ANSWER_KEY = "expected/answer-key.md";

/**
 * Pure: the core readers' outputs in, skill.json (schemaVersion 2) document
 * out. Never throws on defective input — it migrates what it can and notes
 * the rest (the tolerant reader on the other side warns about anything odd).
 */
export const buildSkillJsonDocument = (snapshot: LegacyBundleSnapshot): BuildResult => {
  const notes: string[] = [];
  const b = snapshot.bundleJson;

  // ---- skill (identity) ----
  const slug = asString(b.slug) ?? "";
  if (slug === "") {
    notes.push("bundle.json has no usable slug — skill.slug written empty (fix by hand)");
  }
  const skill: Record<string, unknown> = {
    slug,
    name: typeof b.name === "string" ? b.name : "",
    oneLiner: typeof b.oneLiner === "string" ? b.oneLiner : "",
    tags: stringArray(b.tags),
    created: typeof b.created === "string" ? b.created : "",
    // Renamed: bundle.json "targets" (agent platforms) → "harnesses".
    harnesses: stringArray(b.targets),
    stage: snapshot.stage ?? "idea",
  };

  // ---- design (claims) ----
  const hypotheses: MutableHypothesis[] = [];
  const hypothesisById = new Map<string, MutableHypothesis>();
  // proofSpec prose keyed by case name, to merge onto the case entries.
  const proseByCase = new Map<string, { setup?: string; expectedBehavior?: string }>();
  const caseOrder: string[] = [];
  const rememberCase = (name: string): void => {
    if (!caseOrder.includes(name)) {
      caseOrder.push(name);
    }
  };

  if (snapshot.evalsHypotheses !== undefined) {
    for (const entry of snapshot.evalsHypotheses) {
      const hypothesis: MutableHypothesis = {
        id: entry.id,
        failure: entry.failure,
        ...(entry.probability !== undefined ? { probability: entry.probability } : {}),
        ...(entry.impact !== undefined ? { impact: entry.impact } : {}),
        ...(entry.mustNever !== undefined ? { mustNever: entry.mustNever } : {}),
        cases: [],
      };
      for (const spec of entry.proofSpecs) {
        if (!hypothesis.cases.includes(spec.name)) {
          hypothesis.cases.push(spec.name);
        }
        rememberCase(spec.name);
        if (!proseByCase.has(spec.name)) {
          proseByCase.set(spec.name, {
            ...(spec.setup !== undefined ? { setup: spec.setup } : {}),
            ...(spec.expectedBehavior !== undefined ? { expectedBehavior: spec.expectedBehavior } : {}),
          });
        }
      }
      hypotheses.push(hypothesis);
      hypothesisById.set(entry.id, hypothesis);
    }
  } else if (snapshot.riskMapRows !== undefined) {
    // No evals.json: the legacy risk-map's rows ARE the claims — absorbed
    // here (and the file deleted) so a migrated bundle loses nothing.
    notes.push("no evals.json — claims absorbed from evals/risk-map.md");
    for (const row of snapshot.riskMapRows) {
      if (hypothesisById.has(row.riskId)) continue;
      const hypothesis: MutableHypothesis = {
        id: row.riskId,
        failure: row.description,
        cases: row.fixtureCase !== undefined ? [row.fixtureCase] : [],
      };
      if (row.fixtureCase !== undefined) rememberCase(row.fixtureCase);
      hypotheses.push(hypothesis);
      hypothesisById.set(row.riskId, hypothesis);
    }
  }

  // ---- evals.cases (definitions) — proofSpec names ∪ case dirs ----
  for (const name of [...snapshot.caseJsons.keys()].sort()) {
    rememberCase(name);
  }

  const cases: MutableCase[] = [];
  for (const name of caseOrder) {
    const caseEntry: MutableCase = { name };
    const prose = proseByCase.get(name);
    if (prose?.setup !== undefined) caseEntry.setup = prose.setup;
    if (prose?.expectedBehavior !== undefined) caseEntry.expectedBehavior = prose.expectedBehavior;

    const rawCaseJson = snapshot.caseJsons.get(name);
    if (isRecord(rawCaseJson)) {
      const klass = asString(rawCaseJson.class);
      if (klass !== undefined) caseEntry.class = klass;

      // Reverse the legacy case→risk edge onto the hypotheses (v2's only
      // edge is hypothesis→case).
      for (const riskId of stringArray(rawCaseJson.risks)) {
        const hypothesis = hypothesisById.get(riskId);
        if (hypothesis !== undefined) {
          if (!hypothesis.cases.includes(name)) hypothesis.cases.push(name);
        } else {
          const stub: MutableHypothesis = { id: riskId, failure: "", cases: [name] };
          hypotheses.push(stub);
          hypothesisById.set(riskId, stub);
          notes.push(
            `case "${name}" pointed at risk "${riskId}" which no claims source describes — stub hypothesis written (fill in its failure description)`,
          );
        }
      }

      // Old setup {files, env} → sandbox (v2's `setup` is prose).
      if (isRecord(rawCaseJson.setup)) {
        const sandbox: Record<string, unknown> = {};
        if (asString(rawCaseJson.setup.files) !== undefined) sandbox.files = rawCaseJson.setup.files;
        if (isRecord(rawCaseJson.setup.env)) sandbox.env = rawCaseJson.setup.env;
        if (Object.keys(sandbox).length > 0) caseEntry.sandbox = sandbox;
      }

      if (isRecord(rawCaseJson.grading)) {
        const checks = rawCaseJson.grading.checks;
        if (Array.isArray(checks) && checks.length > 0) caseEntry.checks = stringArray(checks);
        const answerKey = asString(rawCaseJson.grading.answerKey);
        if (answerKey !== undefined && answerKey !== LEGACY_ANSWER_KEY) {
          // A non-conventional answer key stays authored verbatim; the
          // conventional one becomes the v2 default (`expected.md`, moved on
          // disk) and is omitted.
          caseEntry.expected = answerKey;
        }
      }

      if (rawCaseJson.source !== undefined) caseEntry.source = rawCaseJson.source;

      if (typeof rawCaseJson.prompt === "string") {
        notes.push(
          `case "${name}" has a legacy case.json "prompt" string — not migrated (the prompt lives in prompt.md); copy it by hand if prompt.md is missing`,
        );
      }
    } else if (rawCaseJson !== undefined) {
      notes.push(`case "${name}" has a malformed case.json — migrated as a bare case entry`);
    }
    cases.push(caseEntry);
  }

  // ---- assemble ----
  const doc: Record<string, unknown> = {
    schemaVersion: 2,
    skill,
    design: { failureHypotheses: hypotheses.map((h) => ({ ...h })) },
    evals: { cases: cases.map((c) => ({ ...c })), configs: [] },
  };
  const publishTargets = b.publishTargets;
  if (Array.isArray(publishTargets)) {
    doc.publish = { targets: publishTargets };
  }
  return { doc, notes };
};

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
