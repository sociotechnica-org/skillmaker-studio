/**
 * Skill Bundle identity and state.
 * Translated from data-model.md §2.1, §2.3, §2.13.
 */
import { Schema } from "effect";

/**
 * The production stage ladder for a Skill Bundle (ruling F, data-model.md
 * §1.2 / §2.13). `archived` is a separate boolean flag, not a stage.
 */
export const BundleStage = Schema.Literals([
  "idea",
  "researching",
  "drafting",
  "evaluating",
  "published",
]);
export type BundleStage = typeof BundleStage.Type;

/**
 * The [inherited] `ready` flag dissolved into a proper substate (data-model.md
 * §2.13): `review.requested` enters `awaiting-review`, `review.resolved`
 * leaves it. There is no `ready` field anywhere in the model.
 */
export const BundleSubstate = Schema.Literals(["working", "awaiting-review"]);
export type BundleSubstate = typeof BundleSubstate.Type;

/**
 * `skills/<slug>/bundle.json` — identity only, append-slowly (data-model.md
 * §2.3). Nothing mutable-in-anger lives here: no stage, no ready, no status
 * (those are journal replay). The slug is immutable — it keys the journal.
 */
export class BundleIdentity extends Schema.Class<BundleIdentity>("BundleIdentity")({
  schemaVersion: Schema.Literal(1),
  /** Equals the directory name; kebab-case; immutable. */
  slug: Schema.String,
  /** Display name; renames touch this, never the slug. */
  name: Schema.String,
  oneLiner: Schema.String,
  /** Flat taxonomy (ruling B). */
  tags: Schema.Array(Schema.String),
  /** ISO date (YYYY-MM-DD) the bundle was created. */
  created: Schema.String,
  /** Advisory: which agents the skill is written for (e.g. "claude-code"). */
  targets: Schema.Array(Schema.String),
  /**
   * The REMEMBERED install audiences (director rulings 2026-08-03,
   * InstallPublish.ts): where this bundle's output has been published --
   * `"user"` (~/.claude/skills, all my agents) and/or `"project"` (the
   * workspace's own .claude/skills). Symbolic words, never absolute paths,
   * so the fact survives the bundle moving between machines (each machine
   * resolves them locally). Lives here rather than skillmaker.config.json
   * because the choice is per-bundle and must travel WITH the bundle in
   * git. Written only by `InstallPublish.rememberInstallTargets` (a
   * lossless JSON merge, never a schema re-encode), so hand-added fields
   * on bundle.json survive. Additive-optional: absent = never published
   * through the install door.
   */
  publishTargets: Schema.optionalKey(Schema.Array(Schema.Literals(["user", "project"]))),
}) {}

/**
 * Mutable bundle state, materialized by journal replay (never stored as a
 * mutable file — there is no board-state.json descendant; data-model.md
 * §1.3, §2.13).
 */
export class BundleState extends Schema.Class<BundleState>("BundleState")({
  slug: Schema.String,
  /** Current rung on the stage ladder. */
  stage: BundleStage,
  substate: BundleSubstate,
  /** Off/on the active board via bundle.archived / bundle.restored. */
  archived: Schema.Boolean,
  /**
   * The `at` of the last `bundle.stage_changed` for this bundle, or of
   * `bundle.created` if the stage has never changed since (issue #82).
   * Absent for a bundle implicitly created by the tolerant fold (referenced
   * before any `bundle.created`) -- there is no honest timestamp for that
   * case. Generic on purpose: this is "when did the bundle last land on its
   * current rung," useful well beyond the Published-column doorway.
   */
  stageChangedAt: Schema.optionalKey(Schema.String),
}) {}
