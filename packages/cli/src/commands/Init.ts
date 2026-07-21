/**
 * `skillmaker init` — scaffold skillmaker.config.json, skills/, .skillmaker/,
 * and the .gitignore/.gitattributes blocks (re-running is a zero-file-change
 * no-op for that part, data-model.md §2.1, plan.md Phase 1), THEN finish the
 * job (docs/proposals/2026-07-20-install-simplification.md Phase A.5):
 *
 * 1. Sweep the repo — and ONLY the repo — for pre-existing skills, via the
 *    SAME `adopt --triage` machinery `Triage.ts` already exposes — no new
 *    discovery code. The sweep is restricted to the project directory:
 *    never parent dirs, sibling dirs, or home-directory registries like
 *    `~/.claude/skills/` (friction log entry #1, director ruling
 *    2026-07-21: "it should restrict itself to the project directory
 *    only... always"). A non-empty sweep writes `adopt-manifest.md` at the
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
  HARNESS_KINDS,
  HARNESS_LABEL,
  HARNESS_SKILL_INSTALL_DIR,
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
import { type CliResult, ok } from "../CliResult.ts";
import { ensureGitattributes, ensureGitignore } from "../GitFiles.ts";
import { SKILLMAKER_SKILL_MD } from "../SkillTemplate.ts";

export interface InitOptions {
  readonly json: boolean;
}

/**
 * Runs `Triage.ts`'s `triageWorkspace` over the project root and NOTHING
 * else. In-repo `.claude/skills/`, `.agents/skills/`, and bare `SKILL.md`
 * anywhere in the tree are all covered by sweeping `root` itself
 * (`Adopt.ts`'s `walk` never excludes `.claude`/`.agents`).
 *
 * Deliberately NO out-of-tree sweep -- no parent dirs, no sibling dirs, no
 * home-directory registries (`~/.claude/skills`, `~/.codex/skills`,
 * `~/.agents/skills`). An earlier version swept those spots too and
 * surprised users by "finding" their personal skill library in a fresh
 * project (friction log entry #1; director ruling 2026-07-21: "it should
 * restrict itself to the project directory only... always"). Do not
 * reintroduce an out-of-tree sweep, flagged or otherwise.
 */
const sweepExistingSkills = Effect.fn("Init.sweepExistingSkills")(function* (
  root: string,
  journalPath: string,
) {
  return yield* triageWorkspace(root).pipe(Effect.provide(JournalLayer(journalPath)));
});

const MANIFEST_FILENAME = "adopt-manifest.md";

/**
 * The repo-local paths `registerSkill` itself installs the `/skillmaker`
 * skill into (`.claude/skills/skillmaker`, `.agents/skills/skillmaker`) --
 * excluded from the sweep so a second `init` doesn't offer its own
 * self-installed SKILL.md back to the user as something to adopt (F3: a
 * second run must be a no-op, not re-discover what the first run just
 * wrote).
 */
const OWN_SKILL_INSTALL_PATHS: ReadonlySet<string> = new Set(
  HARNESS_KINDS.map((kind) => `${HARNESS_SKILL_INSTALL_DIR[kind]}/skillmaker`),
);

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

  const rawSweep = yield* sweepExistingSkills(root, journalPath);
  const sweep: TriageWorkspaceResult = {
    ...rawSweep,
    rows: rawSweep.rows.filter((row) => !OWN_SKILL_INSTALL_PATHS.has(row.path)),
  };
  let manifestPath: string | undefined;
  let manifestSkippedExisting = false;
  if (sweep.rows.length > 0) {
    manifestPath = path.join(root, MANIFEST_FILENAME);
    const manifestAlreadyExists = yield* fs.exists(manifestPath);
    if (manifestAlreadyExists) {
      // F4: never clobber a manifest the user may already be hand-editing
      // (triage decisions, "whose" assignments) -- only `adopt --triage`'s
      // explicit regeneration is allowed to overwrite it.
      manifestSkippedExisting = true;
    } else {
      yield* fs.writeFileString(manifestPath, renderManifest(sweep.rows));
    }
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
    manifestSkippedExisting,
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
  readonly manifestSkippedExisting: boolean;
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
          manifestSkippedExisting: input.manifestSkippedExisting,
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

  if (input.manifestPath !== undefined && input.manifestSkippedExisting) {
    lines.push(
      `skillmaker: found ${input.sweep.rows.length} existing skill(s) in this project -- ${input.manifestPath} already exists, left untouched`,
    );
    lines.push(`  (run "skillmaker adopt --triage" to regenerate it)`);
  } else if (input.manifestPath !== undefined) {
    lines.push(
      `skillmaker: found ${input.sweep.rows.length} existing skill(s) in this project -- wrote ${input.manifestPath}`,
    );
  } else if (input.sweep.skipped.length === 0) {
    lines.push(`skillmaker: no existing skills found in this project (.claude/skills, .agents/skills, bare SKILL.md)`);
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
