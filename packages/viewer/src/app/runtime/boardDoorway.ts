/**
 * The Published column's doorway (issue #82, stock-and-flow ruling #80): a
 * skill passes *through* Published on its way to the Lab, not retires
 * there. A published bundle shows a card only while its `stageChangedAt`
 * is within `DOORWAY_WINDOW_DAYS` of `now`; older ones are elided, counted
 * by the column's "N in the Lab →" footer instead (no silent truncation --
 * nothing is hidden from the Lab or the journal, only from this one
 * column's cards).
 *
 * Pure, unit-tested without React -- same shape as `labOrder.ts`, and the
 * explicit-`now` parameter mirrors `FoldTodos.ts`'s `isArchived`: time-
 * dependent logic never reads the wall clock itself, so callers (here,
 * `Board.tsx`, evaluated fresh on every render) decide when "now" is.
 */
import type { BundleRecord } from "./schemas.ts";

/** [inherited window]: a published bundle keeps its Board card for this many days after `stageChangedAt`. */
export const DOORWAY_WINDOW_DAYS = 7;

/**
 * True while a bundle's `stageChangedAt` is still within the doorway
 * window as of `now`. A bundle with no `stageChangedAt` at all (old
 * journal, or a tolerant-fold edge case with no `bundle.created`/
 * `bundle.stage_changed` ever seen) has no honest "just arrived" signal,
 * so it is treated as outside the window -- elided, not assumed fresh.
 */
export const isWithinDoorway = (
  bundle: Pick<BundleRecord, "stageChangedAt">,
  now: Date,
): boolean => {
  if (bundle.stageChangedAt === undefined) {
    return false;
  }
  const stageChangedAtMs = Date.parse(bundle.stageChangedAt);
  if (Number.isNaN(stageChangedAtMs)) {
    return false;
  }
  const ageDays = (now.getTime() - stageChangedAtMs) / (24 * 60 * 60 * 1000);
  return ageDays < DOORWAY_WINDOW_DAYS;
};

export interface DoorwayPartition {
  /** Bundles that still show a card in the Published column. */
  readonly visible: ReadonlyArray<BundleRecord>;
  /** Exact count of published bundles elided because they've aged out -- feeds the footer, never truncated silently. */
  readonly elidedCount: number;
}

/** Splits a Published column's bundles into what shows a card and what's elided to the Lab footer. */
export const partitionDoorway = (
  bundles: ReadonlyArray<BundleRecord>,
  now: Date,
): DoorwayPartition => {
  const visible: BundleRecord[] = [];
  let elidedCount = 0;
  for (const bundle of bundles) {
    if (isWithinDoorway(bundle, now)) {
      visible.push(bundle);
    } else {
      elidedCount += 1;
    }
  }
  return { visible, elidedCount };
};
