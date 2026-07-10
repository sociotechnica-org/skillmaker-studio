/**
 * Runs — `skills/<slug>/runs/<run-id>/run.json` (data-model.md §2.8).
 * A record artifact: written at start, finalized at end, then immutable.
 */
import { Schema } from "effect";
import { Actor } from "./Actor.ts";

/** eval | station — station runs do a production-state-machine station's work. */
export const RunKind = Schema.Literals(["eval", "station"]);
export type RunKind = typeof RunKind.Type;

/**
 * `infra-error` vs `failed` keeps the inherited infra/skill failure split:
 * auth/sandbox/connection faults never pollute pass rates.
 */
export const RunStatus = Schema.Literals([
  "running",
  "completed",
  "failed",
  "infra-error",
]);
export type RunStatus = typeof RunStatus.Type;

/**
 * A run = one fixture case × one recorded skill version × one provider
 * (+model). The grade is NOT here — grading is a decision, so it is a
 * journal event (`run.graded`).
 */
export class RunRecord extends Schema.Class<RunRecord>("RunRecord")({
  schemaVersion: Schema.Literal(1),
  /** ULID = directory name. */
  id: Schema.String,
  bundle: Schema.String,
  kind: RunKind,
  /** The state id when kind = "station"; null for eval runs. */
  station: Schema.NullOr(Schema.String),
  /** Eval runs only. */
  fixtureCase: Schema.optionalKey(Schema.String),
  skillVersionHash: Schema.String,
  /** Provider id from skillmaker.config.json (e.g. "claude-code"). */
  provider: Schema.String,
  /** Model as reported by the provider. */
  model: Schema.String,
  startedAt: Schema.String,
  /** Absent while status is "running". */
  endedAt: Schema.optionalKey(Schema.String),
  status: RunStatus,
  /** Who launched the run. */
  actor: Actor,
}) {}
