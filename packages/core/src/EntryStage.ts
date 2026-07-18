/**
 * The entry-stage derivation (issue #108, generalized for issue #115):
 * one system-owned read of a directory's observable condition, shared by
 * every door that grants a bundle identity at birth. Originally lived
 * entirely in `Triage.ts` (bulk import's `adopt --from-manifest`); issue
 * #115 found the single-crate dock door (`Route.ts`'s `landAndAdopt`,
 * shared by `new`/`fork`) disagreeing -- it defaulted an unspecified entry
 * to `"idea"` instead of deriving it, the same brownfield content landing
 * at a different stage depending on which door it walked through. This
 * module is the one place both doors call into now, so they can never
 * drift apart again.
 */
import { Effect } from "effect";
import type { Actor } from "./Actor.ts";
import type { Frontmatter } from "./Adopt.ts";
import type { BundleStage } from "./Bundle.ts";
import { Journal } from "./JournalService.ts";

/** `Adopt.ts`'s `parseFrontmatter` stamps this exact warning when `SKILL.md` carries no `---` frontmatter block at all -- the one signal `parses` below reads. */
export const NO_FRONTMATTER_MARKER = "no frontmatter block found";

/**
 * The two observables `deriveEntryStage` consults -- deliberately narrower
 * than `Triage.ts`'s own `MechanicalCondition` (which adds `hasEvals`, a
 * fact this derivation never uses, per `deriveEntryStage`'s own doc
 * comment below). A structural type, not an import of `MechanicalCondition`
 * itself: `Route.ts` has no fixture scan to report a third field from, and
 * `MechanicalCondition`'s extra field would otherwise force it to fake one.
 */
export interface MechanicalReading {
  readonly parses: boolean;
  readonly complete: boolean;
}

const stringField = (data: Frontmatter, key: string): string | undefined => {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/**
 * `{parses, complete}` from a `SKILL.md` frontmatter parse (`Adopt.ts`'s
 * `parseFrontmatter`'s own `{data, warnings}` shape) -- the one place both
 * `Triage.ts`'s `computeMechanicalCondition` (which layers `hasEvals` on
 * top via `scanFixtures`) and `Route.ts`'s `landAndAdopt` (which has no
 * fixture scan to run) read these two facts, so neither re-derives them by
 * hand.
 */
export const computeMechanicalReading = (
  frontmatter: Frontmatter,
  frontmatterWarnings: ReadonlyArray<string>,
): MechanicalReading => {
  const parses = !frontmatterWarnings.some((warning) => warning.includes(NO_FRONTMATTER_MARKER));
  const complete =
    stringField(frontmatter, "name") !== undefined && stringField(frontmatter, "description") !== undefined;
  return { parses, complete };
};

/**
 * The system's own placement of a brownfield import (issue #108, replacing
 * the retired maturity self-grade; data-model draft §Receive "Triage":
 * "Entry column is derived from what's observably there (no runnable output
 * → early columns; runnable output → Proof)"). A MACHINE DERIVATION from
 * observables, never testimony -- no human is asked anything, on EITHER
 * door that lands a fresh identity (bulk triage's `--from-manifest`, the
 * dock's single-crate `route --as new/fork`, issue #115):
 *
 * - `parses && complete` -> `"evaluating"` (Proof): a runnable `SKILL.md`
 *   with a full identity (name + description) is observably present; the
 *   remaining work is proving it, and the Lab's Proof column is where
 *   fixtures get written against real behavior. Never `"published"` -- this
 *   studio has performed zero evaluation of an import, and `"published"`
 *   would overclaim (house law: never a false fact).
 * - `parses` (but incomplete) -> `"drafting"`: skill text exists but isn't
 *   a complete identity yet -- a draft, observably.
 * - otherwise -> `"idea"`: nothing runnable to point at.
 *
 * `hasEvals` deliberately plays no part -- the parameter type says so:
 * evals present is Proof-column WORK already staged, not a further rung --
 * the entry column question is only "is there runnable output" (draft
 * L202). Narrowing to the two consulted facts also spares the caller
 * `scanFixtures`' directory walk, which only ever answered `hasEvals`.
 */
export const deriveEntryStage = (condition: MechanicalReading): BundleStage => {
  if (condition.parses && condition.complete) {
    return "evaluating";
  }
  if (condition.parses) {
    return "drafting";
  }
  return "idea";
};

/**
 * One `bundle.stage_changed` from `"idea"` to the DERIVED entry stage, when
 * past idea (issue #108, generalized issue #115) -- the one append both
 * `Triage.ts`'s `executeManifestRow` and `Route.ts`'s `landAndAdopt` call,
 * each passing its own door-specific `reason` (`TRIAGE_ENTRY_STAGE_REASON`/
 * `ROUTE_ENTRY_STAGE_REASON`). `parses`/`complete` come from the frontmatter
 * parse the caller's own `adoptDirectoryInPlace` just performed on the
 * `SKILL.md` this bundle was minted from -- observables at execution time,
 * never read back from a hand-editable cell (a machine column is for a
 * human's reference, not load-bearing for execution; an entry stage must
 * come from observables, not from testimony a maker could have edited). No
 * `scanFixtures` walk here: `deriveEntryStage` consults only these two facts
 * (`hasEvals` plays no part), so a fixture scan would be wasted I/O over a
 * tree the caller's own hashing pass is about to walk anyway. NO `override`
 * on the event: this is not a human overriding the guard, it is the
 * system's own placement at birth -- the guard (`Machine.ts`'s
 * `checkTransition`) is enforced at the interactive write paths (`advance`,
 * the server's POST allowlist), not here.
 */
export const appendDerivedEntryStageChange = Effect.fn("EntryStage.appendDerivedEntryStageChange")(function* (
  slug: string,
  frontmatter: Frontmatter,
  frontmatterWarnings: ReadonlyArray<string>,
  actor: Actor,
  reason: string,
) {
  const to = deriveEntryStage(computeMechanicalReading(frontmatter, frontmatterWarnings));
  if (to === "idea") {
    return;
  }
  const journal = yield* Journal;
  yield* journal.append({
    type: "bundle.stage_changed",
    actor,
    payload: { bundle: slug, from: "idea", to, reason },
  });
});
