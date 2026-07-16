/**
 * The journal fold: pure, total replay of `JournalEvent`s into per-bundle
 * state (data-model.md §1.3, §2.11, §2.13). This is "the board *is* a
 * journal replay" — there is no mutable state file; `BundleState` is always
 * derived.
 *
 * Phase 2 applies transitions verbatim (guard enforcement is Phase 4's
 * job — this fold never rejects an event). Bundles referenced by an event
 * before any `bundle.created` are created implicitly with that event's
 * effect applied on top of the default state (tolerant fold).
 *
 * `stageChangedAt` (issue #82) is stamped with the `at` of `bundle.created`
 * and of every `bundle.stage_changed`, forward or backward -- there is no
 * special case for a bundle pulled backward (e.g. published -> drafting):
 * it is just another stage change, and the timestamp always reflects the
 * most recent one. A bundle created only by the tolerant fold (no
 * `bundle.created` seen) has no `stageChangedAt` -- there is no honest
 * timestamp to give it.
 */
import { BundleState } from "./Bundle.ts";
import type { JournalEvent } from "./Journal.ts";

const defaultState = (slug: string): BundleState =>
  BundleState.make({ slug, stage: "idea", substate: "working", archived: false });

/**
 * Folds an ordered list of journal events into current per-bundle state.
 * Pure and total: unknown/irrelevant event types are ignored, and a bundle
 * referenced without a prior `bundle.created` is implicitly created with the
 * default state before the referencing event's effect is applied.
 */
export const foldBundleStates = (
  events: ReadonlyArray<JournalEvent>,
): ReadonlyMap<string, BundleState> => {
  const states = new Map<string, BundleState>();

  const ensure = (slug: string): BundleState => {
    const existing = states.get(slug);
    if (existing !== undefined) {
      return existing;
    }
    const created = defaultState(slug);
    states.set(slug, created);
    return created;
  };

  for (const event of events) {
    switch (event.type) {
      case "bundle.created": {
        const current = ensure(event.payload.bundle);
        states.set(current.slug, BundleState.make({ ...current, stageChangedAt: event.at }));
        break;
      }
      case "bundle.stage_changed": {
        const current = ensure(event.payload.bundle);
        states.set(
          current.slug,
          BundleState.make({ ...current, stage: event.payload.to, stageChangedAt: event.at }),
        );
        break;
      }
      case "bundle.archived": {
        const current = ensure(event.payload.bundle);
        states.set(current.slug, BundleState.make({ ...current, archived: true }));
        break;
      }
      case "bundle.restored": {
        const current = ensure(event.payload.bundle);
        states.set(current.slug, BundleState.make({ ...current, archived: false }));
        break;
      }
      case "review.requested": {
        const current = ensure(event.payload.bundle);
        states.set(
          current.slug,
          BundleState.make({ ...current, substate: "awaiting-review" }),
        );
        break;
      }
      case "review.resolved": {
        const current = ensure(event.payload.bundle);
        states.set(current.slug, BundleState.make({ ...current, substate: "working" }));
        break;
      }
      default:
        // bundle.gate_decided, skill.*, todo.*, run.*, station.started: no
        // effect on BundleState.
        break;
    }
  }

  return states;
};

/**
 * Best-effort extraction of the bundle a journal event concerns, for the
 * `events` index mirror (data-model.md §2.11: `bundle` column). Looks at the
 * event's direct `bundle` field, and one level of nesting for the two event
 * types that carry a bundle inside a nested record instead.
 */
export const bundleForEvent = (event: JournalEvent): string | undefined => {
  switch (event.type) {
    case "bundle.created":
    case "bundle.stage_changed":
    case "bundle.gate_decided":
    case "bundle.archived":
    case "bundle.restored":
    case "skill.version_recorded":
    case "skill.published":
    case "skill.shipped":
    case "skill.field_report":
    case "station.started":
    case "review.requested":
    case "review.resolved":
      return event.payload.bundle;
    case "run.started":
      return event.payload.run.bundle;
    case "todo.opened":
      return event.payload.todo.bundle;
    case "todo.updated":
      return event.payload.patch.bundle;
    case "run.completed":
    case "run.graded":
    case "todo.status_changed":
      return undefined;
    // `skill.received` (issue #90) carries `intake`, never `bundle` -- a
    // crate has no identity yet. Explicitly listed (not left to the
    // `default` below) so this stays a deliberate fact, not an oversight:
    // the Activity feed renders it workspace-level, like nothing else does.
    case "skill.received":
      return undefined;
    default:
      return undefined;
  }
};
