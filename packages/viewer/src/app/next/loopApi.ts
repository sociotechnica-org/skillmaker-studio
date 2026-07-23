/**
 * Loop client helpers for the next shell (UI pending design): pure payload
 * builders + thin typed fetch wrappers for the production-loop actions --
 * create skill, adopt (import) an existing SKILL.md, resolve a review,
 * advance a stage, move a stage back. The surface design for these actions
 * is still being ruled on, so NOTHING here renders; components will consume
 * these helpers once the design lands.
 *
 * Endpoint map (agent-first parity, house rule D6 -- every door here is the
 * same core path a CLI command takes):
 * - create:         POST /api/bundles                  { slug, name? }
 *                     (existing; `Workspace.createBundle`, same as `skillmaker new`)
 * - adopt/import:   POST /api/adopt                    { path? }
 *                     (added with this change; same pipeline as `skillmaker adopt`:
 *                      registry tripwire + `adoptWorkspace` + identical journal writes)
 * - resolve review: POST /api/events  review.resolved  { bundle, state, decision, notes? }
 *                     (existing; server 409s unless the bundle is awaiting review at `state`)
 * - advance:        POST /api/events  bundle.stage_changed { bundle, from, to }
 *                     (existing; `Machine.checkTransition` guard runs server-side, 409 carries the reason)
 * - move back:      POST /api/events  bundle.stage_changed { bundle, from, to, reason }
 *                     (existing; backward is always legal WITH a non-empty reason -- the
 *                      legal-backward mechanic, data-model.md §2.13)
 *
 * Review-honesty rules (#130) enforced at the builder level so no future UI
 * can accidentally weaken them:
 * - send-back (`revise`) REQUIRES non-empty notes;
 * - approve accepts OPTIONAL notes (trimmed, omitted when blank -- approve
 *   notes are for-the-record commentary, never agent instructions);
 * - builders never invent state: callers pass the REQUESTING station's wire
 *   state (the `review.requested` event's `state`), never the current stage.
 *
 * Builders are pure and return a tagged result (never throw) so a form can
 * show the violation inline without a network round-trip; the server remains
 * the real authority (guards re-check everything on append).
 */
import { Schema } from "effect";
import { createBundle, postEvent, type PostEventInput } from "../runtime/api.ts";
import { postJson } from "../runtime/client.ts";
import { STAGES } from "../runtime/schemas.ts";
import type { BundleStage } from "../runtime/schemas.ts";

// ---------------------------------------------------------------------------
// Pure payload builders
// ---------------------------------------------------------------------------

export type BuildResult =
  | { readonly ok: true; readonly input: PostEventInput }
  | { readonly ok: false; readonly error: string };

/**
 * `review.resolved` payload. Approve may carry optional notes; send-back
 * (`revise`) requires them -- a send-back without notes gives the agent
 * nothing to act on, which #130 rules dishonest.
 */
export const buildReviewResolution = (
  bundle: string,
  /** The REQUESTING station's wire state -- whose work is being judged. */
  state: BundleStage,
  decision: "approve" | "revise",
  notes: string | undefined,
): BuildResult => {
  const trimmed = notes?.trim() ?? "";
  if (decision === "revise" && trimmed.length === 0) {
    return { ok: false, error: "Send back requires notes -- say what needs to change." };
  }
  return {
    ok: true,
    input: {
      type: "review.resolved",
      payload: {
        bundle,
        state,
        decision,
        ...(trimmed.length > 0 ? { notes: trimmed } : {}),
      },
    },
  };
};

/** The stage one rung up the ladder from `stage`, or undefined at the top. */
export const nextStage = (stage: BundleStage): BundleStage | undefined =>
  STAGES[STAGES.indexOf(stage) + 1];

/**
 * Forward `bundle.stage_changed` payload: one stage at a time, `to` computed
 * from the ladder -- callers never pick an arbitrary destination. The
 * approved-review guard is the SERVER's to enforce (`checkTransition`); the
 * builder only refuses moves that are impossible by construction.
 */
export const buildAdvance = (bundle: string, from: BundleStage): BuildResult => {
  const to = nextStage(from);
  if (to === undefined) {
    return { ok: false, error: `"${from}" is the last stage -- there is nowhere to advance to.` };
  }
  return {
    ok: true,
    input: { type: "bundle.stage_changed", payload: { bundle, from, to } },
  };
};

/**
 * Backward `bundle.stage_changed` payload -- the legal-backward mechanic:
 * always legal, but only with a non-empty reason (regression is a modeled
 * fact, not an embarrassment). `to` must actually be earlier than `from`.
 */
export const buildMoveBack = (
  bundle: string,
  from: BundleStage,
  to: BundleStage,
  reason: string,
): BuildResult => {
  if (STAGES.indexOf(to) >= STAGES.indexOf(from)) {
    return { ok: false, error: `"${to}" is not earlier than "${from}" -- moving back requires an earlier stage.` };
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Moving to an earlier stage requires a reason." };
  }
  return {
    ok: true,
    input: { type: "bundle.stage_changed", payload: { bundle, from, to, reason: trimmed } },
  };
};

// ---------------------------------------------------------------------------
// Fetch helpers (thin; every result is a tagged ok/error, never a throw on
// domain rejections -- a guard 409's reason is the inline message)
// ---------------------------------------------------------------------------

export type LoopActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

const postBuilt = async (built: BuildResult): Promise<LoopActionResult> => {
  if (!built.ok) {
    return built;
  }
  const result = await postEvent(built.input);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
};

/** Approve or send back the pending review of `state`'s work. */
export const resolveReview = (
  bundle: string,
  state: BundleStage,
  decision: "approve" | "revise",
  notes: string | undefined,
): Promise<LoopActionResult> => postBuilt(buildReviewResolution(bundle, state, decision, notes));

/** Advance one stage forward (guard-checked server-side; a 409 reason surfaces as the error). */
export const advanceStage = (bundle: string, from: BundleStage): Promise<LoopActionResult> =>
  postBuilt(buildAdvance(bundle, from));

/** Move back to an earlier stage, with the required reason. */
export const moveBackStage = (
  bundle: string,
  from: BundleStage,
  to: BundleStage,
  reason: string,
): Promise<LoopActionResult> => postBuilt(buildMoveBack(bundle, from, to, reason));

export type CreateSkillResult =
  | { readonly ok: true; readonly slug: string }
  | { readonly ok: false; readonly error: string };

/**
 * Create a new skill bundle (`POST /api/bundles`, same core path as
 * `skillmaker new`). `already_exists` is a 200 on the wire but an error to a
 * create form -- reported honestly, nothing scaffolded twice.
 */
export const createSkill = async (slug: string, name: string | undefined): Promise<CreateSkillResult> => {
  const trimmedSlug = slug.trim();
  if (trimmedSlug.length === 0) {
    return { ok: false, error: "A slug is required." };
  }
  const trimmedName = name?.trim();
  const result = await createBundle(
    trimmedSlug,
    trimmedName !== undefined && trimmedName.length > 0 ? trimmedName : undefined,
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  if (result.response.status === "already_exists") {
    return { ok: false, error: `A skill named "${result.response.slug}" already exists.` };
  }
  return { ok: true, slug: result.response.slug };
};

/** One adopted skill, as the report names it. */
export class AdoptedEntry extends Schema.Class<AdoptedEntry>("AdoptedEntry")({
  slug: Schema.String,
  path: Schema.String,
  warnings: Schema.Array(Schema.String),
}) {}

/**
 * `POST /api/adopt`'s report, decoded defensively: only the fields a caller
 * acts on. `skippedCount` = already-adopted candidates; `challengedCount` =
 * evidence-bearing arrivals the tripwire refused to stamp (they belong at
 * the receiving dock, out of this v1's scope per D1/D2).
 */
export class AdoptReport extends Schema.Class<AdoptReport>("AdoptReport")({
  found: Schema.Number,
  adopted: Schema.Array(AdoptedEntry),
  skipped: Schema.Array(Schema.Struct({ relativePath: Schema.String })),
  challenged: Schema.Array(Schema.Struct({ path: Schema.String })),
  warnings: Schema.Array(Schema.String),
}) {}

export type AdoptResult =
  | { readonly ok: true; readonly report: AdoptReport }
  | { readonly ok: false; readonly error: string };

/**
 * Import an existing SKILL.md (`POST /api/adopt`, same core path as
 * `skillmaker adopt`). `path` is project-relative: a `SKILL.md` file or a
 * directory containing one. A clean run that adopted nothing is still an
 * error to an import form -- the report says why (already adopted,
 * challenged, or simply not found), and this surfaces it honestly.
 */
export const adoptSkill = async (path: string): Promise<AdoptResult> => {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "A project-relative path is required." };
  }
  const raw = await postJson("/api/adopt", { path: trimmed });
  if (!raw.ok) {
    const body = raw.body as { error?: unknown };
    return {
      ok: false,
      error: typeof body?.error === "string" ? body.error : `adopt failed with status ${raw.status}`,
    };
  }
  let report: AdoptReport;
  try {
    report = await Schema.decodeUnknownPromise(AdoptReport)(raw.body);
  } catch (cause) {
    return { ok: false, error: `adopt response failed schema decode: ${String(cause)}` };
  }
  if (report.adopted.length === 0) {
    return { ok: false, error: adoptEmptyReason(report) };
  }
  return { ok: true, report };
};

/** Why an adopt run adopted nothing, said plainly (exported for tests). */
export const adoptEmptyReason = (report: AdoptReport): string => {
  if (report.found === 0) {
    return "No SKILL.md found at that path.";
  }
  if (report.skipped.length > 0 && report.challenged.length === 0) {
    return "That skill is already adopted.";
  }
  if (report.challenged.length > 0) {
    return "That skill looks like an arrival from elsewhere -- route it via `skillmaker receive` instead of adopting.";
  }
  return "Nothing was adopted.";
};
