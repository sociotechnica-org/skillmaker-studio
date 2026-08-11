/**
 * Git-visible grade FILES (director ruling 2026-08-11: "can't be journal
 * only. needs to be git-visible grades. good to have journal too").
 *
 * Every grade -- from either door, the CLI's `skillmaker grade` or the
 * server's grading panel (`POST /api/events` with `run.graded`) -- is ALSO
 * written to `runs/<run-id>/grades/<grader>/grade.json`, beside the run it
 * grades, so grades travel with the repo in git. The `run.graded` journal
 * event still fires exactly as before (UI liveness over SSE); the file is
 * the git-visible record, the event is the live signal.
 *
 * Regrade shape (append-only history, latest-wins reads): `grade.json`
 * always holds the LATEST grade for that grader. A regrade first archives
 * the current `grade.json` as `grade.<n>.json` (n = 1, 2, ... in grading
 * order, so `grade.1.json` is the oldest), then overwrites `grade.json`.
 * "Latest wins" is therefore a single-file read -- no scanning or sorting
 * needed to resolve the current verdict -- while the full history stays
 * diffable in git.
 *
 * Deliberately plain synchronous `node:fs` (like `IndexService.ts`'s
 * `renameSync` rebuild and the whole server request path): both doors and
 * the index rebuild share these exact functions, and the server door is
 * plain async code. Callers on Effect paths wrap with `Effect.try`.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { Actor } from "./Actor.ts";
import { GradedCheck, RunVerdict } from "./Journal.ts";

/** The grader id for today's human grading, both doors. Agent/LLM graders get their own ids (and lanes) later. */
export const HUMAN_GRADER = "human";

/**
 * One grade, as persisted in `grades/<grader>/grade.json` (and its
 * `grade.<n>.json` history siblings). Mirrors `RunGradedEvent`'s payload
 * plus the envelope facts a standalone file must carry itself (`runId`,
 * `grader`, `gradedAt`, `actor`).
 */
export class GradeRecord extends Schema.Class<GradeRecord>("GradeRecord")({
  schemaVersion: Schema.Literal(1),
  runId: Schema.String,
  grader: Schema.String,
  verdict: RunVerdict,
  /** Mirrors case.json grading.checks as graded checkboxes, when the door supplied them. */
  checks: Schema.optionalKey(Schema.Array(GradedCheck)),
  notes: Schema.optionalKey(Schema.String),
  gradedAt: Schema.String,
  actor: Actor,
}) {}

/** What one `writeGradeFile` did: where the latest grade landed, and (on a regrade) where the prior grade was archived. */
export interface GradeWriteResult {
  /** Absolute path of the freshly written `grade.json`. */
  readonly path: string;
  /** Absolute path the PREVIOUS `grade.json` was archived to (`grade.<n>.json`); absent on a first grade. */
  readonly archivedAs?: string;
}

const HISTORY_FILE = /^grade\.(\d+)\.json$/;

/**
 * Writes `grade.json` under `<runDir>/grades/<grade.grader>/`, archiving any
 * existing `grade.json` to the next `grade.<n>.json` first (append-only
 * history; see the module comment for the shape). Synchronous and throwing
 * on IO failure -- Effect callers wrap with `Effect.try`.
 */
export const writeGradeFile = (runDir: string, grade: GradeRecord): GradeWriteResult => {
  const graderDir = join(runDir, "grades", grade.grader);
  mkdirSync(graderDir, { recursive: true });

  const latestPath = join(graderDir, "grade.json");
  let archivedAs: string | undefined;
  if (existsSync(latestPath)) {
    // Next history slot = max existing n + 1 (not count + 1, so a manually
    // deleted middle entry can never cause a clobbering collision).
    let maxN = 0;
    for (const entry of readdirSync(graderDir)) {
      const match = HISTORY_FILE.exec(entry);
      if (match !== null) {
        maxN = Math.max(maxN, Number(match[1]));
      }
    }
    archivedAs = join(graderDir, `grade.${maxN + 1}.json`);
    renameSync(latestPath, archivedAs);
  }

  writeFileSync(latestPath, `${JSON.stringify(grade, null, 2)}\n`);
  return { path: latestPath, ...(archivedAs !== undefined ? { archivedAs } : {}) };
};

/**
 * One grader's lane for a run: the latest grade plus its archived history
 * (newest first -- regrades are history, not overwrites, same convention as
 * the run-detail panel's `gradingHistory`).
 */
export interface GradeLane {
  readonly grader: string;
  readonly latest: GradeRecord;
  /** Prior grades (`grade.<n>.json`), newest first; empty when never regraded. */
  readonly history: ReadonlyArray<GradeRecord>;
}

export interface ReadGradeLanesResult {
  /** Sorted by grader id for a stable order across machines. */
  readonly lanes: ReadonlyArray<GradeLane>;
  /** Malformed grade files, reported (ruling I) rather than thrown. */
  readonly warnings: ReadonlyArray<string>;
}

const decodeGradeFile = (path: string): GradeRecord =>
  Schema.decodeUnknownSync(GradeRecord)(JSON.parse(readFileSync(path, "utf8")) as unknown);

/**
 * Reads every grader lane under `<runDir>/grades/`. Tolerant of malformed
 * files (each becomes a warning; a lane whose `grade.json` itself is
 * malformed is skipped entirely -- its verdict is unknowable). A missing
 * `grades/` directory reads as no lanes, no warnings: every run graded
 * before this change (journal-only) looks exactly like that.
 */
export const readGradeLanes = (runDir: string): ReadGradeLanesResult => {
  const gradesDir = join(runDir, "grades");
  if (!existsSync(gradesDir)) {
    return { lanes: [], warnings: [] };
  }

  const lanes: GradeLane[] = [];
  const warnings: string[] = [];
  for (const grader of readdirSync(gradesDir).slice().sort()) {
    const graderDir = join(gradesDir, grader);
    const latestPath = join(graderDir, "grade.json");
    if (!existsSync(latestPath)) {
      continue;
    }

    let latest: GradeRecord;
    try {
      latest = decodeGradeFile(latestPath);
    } catch (cause) {
      warnings.push(`grades/${grader}/grade.json is malformed and was skipped: ${String(cause)}`);
      continue;
    }

    // History files, ordered by n descending = newest first.
    const numbered: Array<{ readonly n: number; readonly name: string }> = [];
    for (const entry of readdirSync(graderDir)) {
      const match = HISTORY_FILE.exec(entry);
      if (match !== null) {
        numbered.push({ n: Number(match[1]), name: entry });
      }
    }
    numbered.sort((a, b) => b.n - a.n);
    const history: GradeRecord[] = [];
    for (const { name } of numbered) {
      try {
        history.push(decodeGradeFile(join(graderDir, name)));
      } catch (cause) {
        warnings.push(`grades/${grader}/${name} is malformed and was skipped: ${String(cause)}`);
      }
    }

    lanes.push({ grader, latest, history });
  }

  return { lanes, warnings };
};

/**
 * The single "current grade" of a run across all its lanes -- what the
 * index's `verdict`/`gradedAt`/`gradedBy` columns hold. Latest `gradedAt`
 * wins (same latest-wins semantics the journal fold has always had); a
 * timestamp tie breaks by grader id descending, so the answer is
 * deterministic across machines.
 */
export const latestGrade = (lanes: ReadonlyArray<GradeLane>): GradeRecord | undefined => {
  let winner: GradeRecord | undefined;
  for (const lane of lanes) {
    if (
      winner === undefined ||
      lane.latest.gradedAt > winner.gradedAt ||
      (lane.latest.gradedAt === winner.gradedAt && lane.latest.grader > winner.grader)
    ) {
      winner = lane.latest;
    }
  }
  return winner;
};
