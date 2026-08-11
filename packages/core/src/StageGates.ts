/**
 * The ruled stage-gate table (THE MERGE, director rulings 2026-08-11,
 * docs/proposals/2026-08-11-the-merge-skill-json.md R2) -- artifact-existence
 * guards enforced at the two transition doors (CLI `advance`, server
 * `POST /api/events`), on top of `Machine.checkTransition`'s journal guards:
 *
 *   idea -> researching      HARD: skill name + oneLiner (birth intent)
 *                            non-empty -- "how else will you research"
 *   researching -> drafting  HARD: design.md exists + non-empty
 *   drafting -> evaluating   HARD: output/SKILL.md exists
 *   evaluating -> published  SOFT: >=1 realized case with >=1 graded run --
 *                            warn "publishing unmeasured", NEVER block (the
 *                            Vision's soft-gate ruling; this REPLACED the
 *                            old hard `bundle.gate_decided` requirement)
 *   any -> archived / backward   no gate
 *
 * Gates key on the DESTINATION stage and apply only to forward,
 * non-override transitions -- `--override` remains the journaled escape
 * hatch, and backward moves need only their reason (`Machine.ts`).
 *
 * Derived readiness (`nextStageReadinessSync`) is the SAME checks running
 * continuously: a gate is the check enforced at transition time; readiness
 * is the check answered wherever transitions are offered, so the UI can
 * show ready/not-ready without a second implementation.
 *
 * Sync + node:fs on purpose (the `SkillJson.ts` sync-twin precedent): both
 * doors call this on their request path, and every check is a handful of
 * stats over one bundle directory.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BundleStage } from "./Bundle.ts";
import type { JournalEvent } from "./Journal.ts";
import { STAGES } from "./Machine.ts";
import { casesRootSync, readBundleIdentitySync } from "./SkillJson.ts";

export type StageGateVerdict =
  | { readonly allowed: true; readonly warnings: ReadonlyArray<string> }
  | { readonly allowed: false; readonly reason: string };

/** The soft-gate warning, verbatim on both doors (the ruled "publishing unmeasured" wording). */
export const PUBLISHING_UNMEASURED_WARNING =
  'publishing unmeasured: no realized eval case has a graded run yet -- the skill ships without a single measured claim';

const refuse = (reason: string): StageGateVerdict => ({ allowed: false, reason });
const allow = (warnings: ReadonlyArray<string> = []): StageGateVerdict => ({ allowed: true, warnings });

const nonEmptyFile = (path: string): boolean => {
  try {
    return readFileSync(path, "utf8").trim().length > 0;
  } catch {
    return false;
  }
};

/** Names of case-materials directories that exist on disk (`evals/cases/` post-merge, `evals/fixtures/` legacy) -- the "realized" set. */
const realizedCaseNames = (bundleDir: string): ReadonlySet<string> => {
  const root = casesRootSync(bundleDir);
  const names = new Set<string>();
  if (!existsSync(root)) {
    return names;
  }
  for (const entry of readdirSync(root)) {
    if (entry.startsWith(".")) continue;
    try {
      if (statSync(join(root, entry)).isDirectory()) {
        names.add(entry);
      }
    } catch {
      // A vanished entry is simply not realized.
    }
  }
  return names;
};

/**
 * Whether at least one realized case has at least one graded run (the soft
 * publish gate's evidence question). A run counts when its `run.json` is a
 * completed run of a realized case AND it has a grade: a git-visible
 * `runs/<id>/grades/<grader>/grade.json` (the record, Grades.ts), or --
 * for runs graded before grade files existed -- a journal `run.graded`
 * event for its id.
 */
const hasGradedRealizedRun = (bundleDir: string, events: ReadonlyArray<JournalEvent>): boolean => {
  const realized = realizedCaseNames(bundleDir);
  if (realized.size === 0) {
    return false;
  }

  const gradedRunIds = new Set<string>();
  for (const event of events) {
    if (event.type === "run.graded") {
      gradedRunIds.add(event.payload.id);
    }
  }

  const runsDir = join(bundleDir, "runs");
  if (!existsSync(runsDir)) {
    return false;
  }
  for (const runId of readdirSync(runsDir)) {
    if (runId.startsWith(".")) continue;
    const runDir = join(runsDir, runId);
    let run: unknown;
    try {
      run = JSON.parse(readFileSync(join(runDir, "run.json"), "utf8"));
    } catch {
      continue;
    }
    if (typeof run !== "object" || run === null) continue;
    const { fixtureCase, status } = run as { readonly fixtureCase?: unknown; readonly status?: unknown };
    if (status !== "completed") continue;
    if (typeof fixtureCase !== "string" || !realized.has(fixtureCase)) continue;

    if (gradedRunIds.has(runId)) {
      return true;
    }
    const gradesDir = join(runDir, "grades");
    if (!existsSync(gradesDir)) continue;
    for (const grader of readdirSync(gradesDir)) {
      if (existsSync(join(gradesDir, grader, "grade.json"))) {
        return true;
      }
    }
  }
  return false;
};

/**
 * The ruled gate for arriving at `to`, checked against the bundle's files
 * (+ `events` for the soft gate's grade evidence). Callers apply it to
 * forward, non-override transitions only -- backward moves and overrides
 * bypass gates by design. Hard refusals carry a clean, user-readable
 * reason; the soft gate always allows and at most warns.
 */
export const checkStageGateSync = (
  bundleDir: string,
  to: BundleStage,
  events: ReadonlyArray<JournalEvent>,
): StageGateVerdict => {
  switch (to) {
    case "researching": {
      const identity = readBundleIdentitySync(bundleDir);
      const name = identity?.name.trim() ?? "";
      const oneLiner = identity?.oneLiner.trim() ?? "";
      if (name.length === 0 || oneLiner.length === 0) {
        return refuse(
          'cannot advance to "researching": the bundle needs a non-empty name and one-liner (its birth intent) -- how else will you research? Set them in skill.json\'s "skill" section',
        );
      }
      return allow();
    }
    case "drafting": {
      if (!nonEmptyFile(join(bundleDir, "design.md"))) {
        return refuse(
          'cannot advance to "drafting": design.md is missing or empty -- researching produces the design before drafting begins',
        );
      }
      return allow();
    }
    case "evaluating": {
      if (!existsSync(join(bundleDir, "output", "SKILL.md"))) {
        return refuse(
          'cannot advance to "evaluating": output/SKILL.md does not exist -- drafting produces the draft skill that evaluating measures',
        );
      }
      return allow();
    }
    case "published": {
      // SOFT (the Vision's soft-gate ruling): warn, NEVER block.
      if (!hasGradedRealizedRun(bundleDir, events)) {
        return allow([PUBLISHING_UNMEASURED_WARNING]);
      }
      return allow();
    }
    default:
      return allow();
  }
};

/** Derived readiness for a bundle's next forward stage -- the gate checks answered continuously, for UIs offering the transition. */
export interface StageReadiness {
  /** The next forward stage the readiness speaks about. */
  readonly to: BundleStage;
  /** `"hard"` gates block the transition when unmet; `"soft"` gates only warn. */
  readonly gate: "hard" | "soft";
  /** Whether the gate's checks are currently satisfied. */
  readonly ready: boolean;
  /** The unmet hard-gate reason or soft-gate warnings; empty when ready. */
  readonly reasons: ReadonlyArray<string>;
}

/**
 * The next stage's readiness, or `null` at the top of the ladder. Same
 * checks as `checkStageGateSync` -- one implementation for the gate and the
 * continuously-derived answer.
 */
export const nextStageReadinessSync = (
  bundleDir: string,
  stage: BundleStage,
  events: ReadonlyArray<JournalEvent>,
): StageReadiness | null => {
  const next = STAGES[STAGES.indexOf(stage) + 1];
  if (next === undefined) {
    return null;
  }
  const verdict = checkStageGateSync(bundleDir, next, events);
  const gate = next === "published" ? "soft" : "hard";
  if (!verdict.allowed) {
    return { to: next, gate, ready: false, reasons: [verdict.reason] };
  }
  return { to: next, gate, ready: verdict.warnings.length === 0, reasons: verdict.warnings };
};
