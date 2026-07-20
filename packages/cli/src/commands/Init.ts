/**
 * `skillmaker init` — scaffold skillmaker.config.json, skills/, .skillmaker/,
 * and the .gitignore/.gitattributes blocks (re-running is a zero-file-change
 * no-op for that part, data-model.md §2.1, plan.md Phase 1), THEN finish the
 * job (docs/proposals/2026-07-20-install-simplification.md Phase A.5):
 *
 * 1. Sweep the repo (plus the usual out-of-tree spots — `~/.claude/skills/`,
 *    `~/.codex/skills/`, `~/.agents/skills/`) for pre-existing skills, via
 *    the SAME `adopt --triage` machinery `Triage.ts` already exposes — no
 *    new discovery code. A non-empty sweep writes `adopt-manifest.md` at the
 *    workspace root, exactly like `adopt --triage` does, and tells the user
 *    about it.
 * 2. Detect which agent harness(es) this repo already carries
 *    (`Harness.ts`'s `detectHarnesses`: `.claude/`, `.codex/`).
 * 3. Register the `/skillmaker` skill into every present harness's
 *    repo-local skill directory (`Harness.ts`'s `registerSkill`, shared with
 *    Phase B.7 — one code path).
 * 4. Print ONE explicit next action line, state-dependent: review the
 *    manifest if the sweep found anything, otherwise open the board.
 */
import {
  detectHarnesses,
  HARNESS_LABEL,
  registerSkill,
  renderManifest,
  triageWorkspace,
  Workspace,
  JournalLayer,
  type HarnessDetection,
  type SkillInstallResult,
  type TriageWorkspaceResult,
} from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { homedir } from "node:os";
import { join as nodeJoin } from "node:path";
import { type CliResult, ok } from "../CliResult.ts";
import { ensureGitattributes, ensureGitignore } from "../GitFiles.ts";
import { SKILLMAKER_SKILL_MD } from "../SkillTemplate.ts";

export interface InitOptions {
  readonly json: boolean;
}

type ManifestRow = TriageWorkspaceResult["rows"][number];
type SkippedRow = TriageWorkspaceResult["skipped"][number];

/**
 * The "normal spots" a maker's existing skills live outside this repo
 * entirely (spec §Command Semantics: "`.claude/skills/`, `~/.claude/skills/`,
 * Codex's equivalents"). In-repo `.claude/skills/`, `.agents/skills/`, and
 * bare `SKILL.md` anywhere in the tree are already covered by sweeping
 * `root` itself (`Adopt.ts`'s `walk` never excludes `.claude`/`.agents`).
 *
 * Reads `HOME`/`USERPROFILE` before falling back to `os.homedir()` --
 * `homedir()` resolves the OS's account home directory directly (on Bun,
 * observably ignoring `process.env.HOME` set after startup), so an
 * env-var override is the only way anything, including a test, can point
 * this sweep somewhere other than the real machine's home directory.
 */
const homeSweepDirs = (): ReadonlyArray<string> => {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return [
    nodeJoin(home, ".claude", "skills"),
    nodeJoin(home, ".codex", "skills"),
    nodeJoin(home, ".agents", "skills"),
  ];
};

/**
 * Runs `Triage.ts`'s `triageWorkspace` over the repo root AND every
 * existing home-directory skill spot, merging the results into one
 * combined sweep (registry/evidence always computed against `root`'s own
 * journal, so a row found under `~/.claude/skills/` is checked against the
 * same corpus an in-repo row would be). Deduped by portable path in case a
 * home spot and the in-repo sweep somehow overlap.
 */
const sweepExistingSkills = Effect.fn("Init.sweepExistingSkills")(function* (
  root: string,
  journalPath: string,
) {
  const fs = yield* FileSystem;

  const sweepRoots = [root];
  for (const dir of homeSweepDirs()) {
    if (dir === root || dir.startsWith(`${root}/`) || dir.startsWith(`${root}\\`)) {
      // Already covered by sweeping root itself -- never double-sweep.
      continue;
    }
    const exists = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false));
    if (exists) {
      sweepRoots.push(dir);
    }
  }

  const rows: ManifestRow[] = [];
  const skipped: SkippedRow[] = [];
  const warnings: string[] = [];
  const manifests: TriageWorkspaceResult["manifests"][number][] = [];
  const evalInfra: TriageWorkspaceResult["evalInfra"][number][] = [];
  const seenPaths = new Set<string>();

  for (const sweepRoot of sweepRoots) {
    const result = yield* triageWorkspace(root, sweepRoot).pipe(Effect.provide(JournalLayer(journalPath)));
    for (const row of result.rows) {
      if (seenPaths.has(row.path)) {
        continue;
      }
      seenPaths.add(row.path);
      rows.push(row);
    }
    skipped.push(...result.skipped);
    warnings.push(...result.warnings);
    manifests.push(...result.manifests);
    evalInfra.push(...result.evalInfra);
  }

  return { rows, skipped, warnings, manifests, evalInfra } satisfies TriageWorkspaceResult;
});

const MANIFEST_FILENAME = "adopt-manifest.md";

export const runInit = Effect.fn("runInit")(function* (cwd: string, options: InitOptions) {
  const workspace = yield* Workspace;
  const initResult = yield* workspace.init(cwd);
  const alreadyInitialized = initResult.status === "already_initialized";
  const root = initResult.root;

  const gitignoreChanged = yield* ensureGitignore(root);
  const gitattributesChanged = yield* ensureGitattributes(root);

  const path = yield* Path;
  const fs = yield* FileSystem;
  const journalPath = path.join(root, ".skillmaker", "events.jsonl");

  const sweep = yield* sweepExistingSkills(root, journalPath);
  let manifestPath: string | undefined;
  if (sweep.rows.length > 0) {
    manifestPath = path.join(root, MANIFEST_FILENAME);
    yield* fs.writeFileString(manifestPath, renderManifest(sweep.rows));
  }

  const harnesses = yield* detectHarnesses(root);
  const presentHarnesses = harnesses.filter((h) => h.present);
  const skillInstalls: ReadonlyArray<SkillInstallResult> =
    presentHarnesses.length > 0
      ? yield* registerSkill(root, harnesses, SKILLMAKER_SKILL_MD)
      : [];

  return summarize({
    root,
    alreadyInitialized,
    gitignoreChanged,
    gitattributesChanged,
    sweep,
    manifestPath,
    harnesses,
    skillInstalls,
    json: options.json,
  });
});

interface SummarizeInput {
  readonly root: string;
  readonly alreadyInitialized: boolean;
  readonly gitignoreChanged: boolean;
  readonly gitattributesChanged: boolean;
  readonly sweep: TriageWorkspaceResult;
  readonly manifestPath: string | undefined;
  readonly harnesses: ReadonlyArray<HarnessDetection>;
  readonly skillInstalls: ReadonlyArray<SkillInstallResult>;
  readonly json: boolean;
}

/** The one explicit next action (spec: "the installer ... ends on one explicit next action"). State-dependent: review the manifest first if the sweep found anything to decide on, otherwise go straight to the board. */
const nextActionFor = (input: SummarizeInput): string =>
  input.manifestPath !== undefined
    ? `review ${input.manifestPath}, then run "skillmaker adopt --from-manifest"`
    : `run "skillmaker start" to open the board`;

const summarize = (input: SummarizeInput): CliResult => {
  const nextAction = nextActionFor(input);

  if (input.json) {
    return ok(
      `${JSON.stringify({
        status: input.alreadyInitialized ? "already_initialized" : "initialized",
        root: input.root,
        gitignoreChanged: input.gitignoreChanged,
        gitattributesChanged: input.gitattributesChanged,
        sweep: {
          manifest: input.manifestPath ?? null,
          rowsFound: input.sweep.rows.length,
          alreadyAdopted: input.sweep.skipped.length,
        },
        harnesses: input.harnesses.map((h) => ({ kind: h.kind, present: h.present })),
        skillInstalls: input.skillInstalls.map((s) => ({ kind: s.kind, path: s.path, changed: s.changed })),
        nextAction,
      })}\n`,
    );
  }

  const lines: string[] = [
    input.alreadyInitialized
      ? `skillmaker: already initialized at ${input.root}`
      : `skillmaker: initialized workspace at ${input.root}`,
  ];

  if (input.manifestPath !== undefined) {
    lines.push(
      `skillmaker: found ${input.sweep.rows.length} existing skill(s) nearby -- wrote ${input.manifestPath}`,
    );
  } else if (input.sweep.skipped.length === 0) {
    lines.push(`skillmaker: no existing skills found nearby (.claude/skills, .agents/skills, ~/.claude/skills, ~/.codex/skills, bare SKILL.md)`);
  }
  if (input.sweep.skipped.length > 0) {
    lines.push(`skillmaker: ${input.sweep.skipped.length} skill(s) already adopted, left untouched`);
  }

  const presentHarnesses = input.harnesses.filter((h) => h.present);
  if (presentHarnesses.length > 0) {
    lines.push(`skillmaker: detected ${presentHarnesses.map((h) => HARNESS_LABEL[h.kind]).join(", ")}`);
    for (const install of input.skillInstalls) {
      lines.push(
        `  ${install.changed ? "+" : "="} /skillmaker skill ${install.changed ? "installed at" : "already up to date at"} ${install.path}`,
      );
    }
    if (input.skillInstalls.some((s) => s.changed)) {
      lines.push(`  (repo-local, not yet committed -- consider adding .claude/skills/ and .agents/skills/ to .gitignore if you don't want the skill file tracked)`);
    }
  } else {
    lines.push(`skillmaker: no agent harness detected (.claude/, .codex/) -- skipped /skillmaker skill registration`);
  }

  lines.push(`→ ${nextAction}`);

  return ok(`${lines.join("\n")}\n`);
};
