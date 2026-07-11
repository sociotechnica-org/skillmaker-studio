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
 * `"sandbox-home"`: the ACP adapter subprocess was pointed at a fresh,
 * run-scoped, empty config directory (via the provider profile's
 * `configDirEnvVar`, Fix F6) so it could only see the bundle's own skill --
 * never the operator's real `~/.claude/skills` (or provider equivalent).
 * `"inherited"`: the subprocess ran against the operator's real config
 * directory (pre-fix behavior; also the fallback for any future run path
 * that doesn't set up an isolated sandbox). Recorded per-run so past runs
 * remain honest about which measurement conditions they ran under, even as
 * the isolation mechanism improves going forward.
 */
export const RunIsolation = Schema.Literals(["sandbox-home", "inherited"]);
export type RunIsolation = typeof RunIsolation.Type;

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
  /**
   * Fix F6: how isolated the ACP adapter subprocess's config directory was
   * from the operator's real one. `optionalKey` so `run.json` files written
   * before this fix still decode -- absent means "unknown, predates this
   * field", which callers should treat the same as `"inherited"` (the
   * pre-fix, unisolated behavior) rather than assuming isolation happened.
   */
  isolation: Schema.optionalKey(RunIsolation),
  /**
   * Fix F7: `true` if the transcript shows evidence the agent invoked/read
   * the bundle's skill (`SkillActivation.ts`'s `didSkillActivate`),
   * computed for EVERY run -- not just "trigger"-class fixtures (the
   * previous, narrower `handleRunDetail`-only exposure). `optionalKey` so
   * `run.json` files written before this fix still decode -- absent means
   * "unknown, predates this field", distinct from a computed `false`.
   */
  skillInvoked: Schema.optionalKey(Schema.Boolean),
}) {}
