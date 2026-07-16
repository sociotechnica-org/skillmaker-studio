/**
 * The Receiving Dock (issue #90, `Mechanism - Receiving Dock.md`): the
 * inbound door for arriving skills -- "everything may enter; nothing may
 * pretend." `receiveCrate` copies an arriving skill directory (never moves
 * it -- the maker's file stays untouched) to `receiving/<intake-id>/` and
 * appends `skill.received` (`Journal.ts`'s `SkillReceivedEvent`) carrying an
 * intake id, never a bundle: a crate has no identity yet, that is the whole
 * point of the dock existing before adoption.
 *
 * The dock verdict (`return`/`new`/`conflict`) is computed here for the
 * CLI's completion message, but is NEVER written to the journal (house law:
 * derive, don't store -- `Versions.ts`'s drift hint follows the same rule).
 * `hashReceivedCrate`, `gatherIntakeRegistry`, and `deriveIntakeVerdict` are
 * exported as the three separate steps so the server's `GET /api/intake`
 * can recompute the exact same comparison at read time, live against
 * whatever the registry says right now -- not whatever it said at receive
 * time.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import type { Actor } from "./Actor.ts";
import {
  ReceiveNotASkillError,
  ReceivePathNotDirectoryError,
  ReceivePathNotFoundError,
  WorkspaceIOError,
} from "./Errors.ts";
import { IndexService, layer as IndexServiceLayer } from "./IndexService.ts";
import type { IntakeRights, JournalEvent, SkillReceivedEvent } from "./Journal.ts";
import { Journal } from "./JournalService.ts";
import { ADOPT_EXCLUDED_NAMES, foldSkillVersions, hashOutputTree } from "./Versions.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** `in-<uuid>` -- mirrors `Todo.ts`'s `td-<ulid>` id pattern (the CLI's `todo add` mints `td-` the same way, via `crypto.randomUUID()`). */
export const newIntakeId = (): string => `in-${crypto.randomUUID()}`;

export type IntakeVerdict = "return" | "new" | "conflict";

/**
 * kebab-case fold for loose name/slug comparison. Deliberately a local
 * duplicate of `Adopt.ts`'s `slugify` (not exported/shared from there):
 * both are the same four-line pure string transform, and a cross-module
 * dependency for that is a worse trade than the duplication.
 */
const slugify = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * The crate's content hash, mirroring an in-place-adopted bundle's
 * exclusion rules (`ADOPT_EXCLUDED_NAMES`, `Versions.ts`): a crate that
 * happens to still carry studio scaffolding from wherever it came from
 * (e.g. a returning bundle) hashes to its skill payload, not that
 * scaffolding. The one function both `receiveCrate` (at receive time) and
 * `GET /api/intake` (at read time) call, so "what does this crate hash to"
 * is answered identically everywhere it's asked.
 */
export const hashReceivedCrate = (crateDir: string) =>
  hashOutputTree(crateDir, { excludeTopLevel: ADOPT_EXCLUDED_NAMES });

/**
 * The one shared `skill.received`-by-intake-id lookup (issue #91): every
 * caller resolving `--from-intake`/an intake id against the full journal
 * (`Route.ts`'s `routeCrate`, `Harvest.ts`'s `harvestFixtureFromIntake`,
 * `TodoFromReport.ts`'s `openTodoFromIntake`) needs exactly this type-guarded
 * `find`, so it lives here once instead of three copies that could drift.
 */
export const findReceivedEvent = (
  events: ReadonlyArray<JournalEvent>,
  intake: string,
): SkillReceivedEvent | undefined =>
  events.find((event): event is SkillReceivedEvent => event.type === "skill.received" && event.payload.intake === intake);

export interface IntakeRegistryBundle {
  readonly slug: string;
  readonly name: string;
}

export interface IntakeRegistry {
  readonly bundles: ReadonlyArray<IntakeRegistryBundle>;
  readonly recordedHashes: ReadonlySet<string>;
}

/**
 * The registry side of the dock verdict (`Mechanism - Receiving Dock.md`
 * §HOW: "the registry is the only true witness"): every slug+name the
 * workspace knows about (`IndexService.rebuild`'s own workspace-wide scan,
 * so an in-place-adopted bundle counts wherever it actually lives, not just
 * under `skillsDir`), and every hash ever recorded for any bundle
 * (`foldSkillVersions`, flattened across bundles -- a crate can be `return`
 * against a bundle other than the one its claimed name suggests).
 */
export const gatherIntakeRegistry = Effect.fn("Receive.gatherIntakeRegistry")(function* (
  events: ReadonlyArray<JournalEvent>,
) {
  const index = yield* IndexService;
  yield* index.rebuild();
  const bundles = yield* index.listBundles();

  const recordedHashes = new Set<string>();
  for (const versions of foldSkillVersions(events).values()) {
    for (const version of versions) {
      recordedHashes.add(version.hash);
    }
  }

  return {
    bundles: bundles.map((bundle) => ({ slug: bundle.slug, name: bundle.name })),
    recordedHashes,
  } satisfies IntakeRegistry;
});

/**
 * The dock verdict itself (`Mechanism - Receiving Dock.md` §HOW): `"return"`
 * when the computed hash matches ANY bundle's recorded version (ours coming
 * home, wherever its identity landed); else `"conflict"` when the claimed
 * name overlaps an existing bundle's slug or name with different content
 * (the identically-labeled stranger); else `"new"`. Pure and total -- no
 * claims at all (`claimedName` undefined) still resolves cleanly to
 * `"new"`, never a distinct "no-claims" verdict.
 */
export const deriveIntakeVerdict = (
  computedHash: string,
  claimedName: string | undefined,
  registry: IntakeRegistry,
): IntakeVerdict => {
  if (registry.recordedHashes.has(computedHash)) {
    return "return";
  }
  if (claimedName !== undefined) {
    const claimedSlug = slugify(claimedName);
    const overlapsExisting = registry.bundles.some(
      (bundle) => bundle.slug === claimedSlug || slugify(bundle.name) === claimedSlug,
    );
    if (overlapsExisting) {
      return "conflict";
    }
  }
  return "new";
};

/**
 * Undisposed derivation (issue #90's design note, made real by issue #91's
 * `skill.routed`): "received events with no routing event referencing their
 * intake id." Before #91 shipped, `skill.routed` didn't exist in
 * `Journal.ts`'s union yet, so this read `event.type` as a plain string
 * against a hard-coded `"skill.routed"` literal the union didn't carry --
 * now that `SkillRoutedEvent` is a real member, the filter below narrows on
 * it directly, no cast required. An intake routed `salvage` counts as
 * disposed exactly like every other disposition: "In Receiving" is the
 * place (undisposed, until a human routes it), not a judgment about which
 * way it was routed -- salvage's crate stays physically at
 * `receiving/<intake-id>/` as evidence, but it leaves THIS list.
 */
export const listUndisposedIntake = (
  events: ReadonlyArray<JournalEvent>,
): ReadonlyArray<SkillReceivedEvent> => {
  const routedIntakeIds = new Set<string>();
  for (const event of events) {
    if (event.type === "skill.routed") {
      routedIntakeIds.add(event.payload.intake);
    }
  }

  return events
    .filter((event): event is SkillReceivedEvent => event.type === "skill.received")
    .filter((event) => !routedIntakeIds.has(event.payload.intake));
};

export interface ReceiveCrateInput {
  readonly workspaceRoot: string;
  /** The directory to copy from -- untouched by this operation (never moved). */
  readonly sourcePath: string;
  readonly source: string;
  readonly ref?: string;
  readonly claimedName?: string;
  readonly claimedVersionHash?: string;
  readonly rights?: IntakeRights;
  readonly notes?: string;
  readonly actor: Actor;
}

export interface ReceiveCrateResult {
  readonly intake: string;
  readonly receivedDir: string;
  readonly verdict: IntakeVerdict;
}

/**
 * Receives one crate at the dock (`Mechanism - Receiving Dock.md` §HOW):
 * validates it's a real single skill directory (never a sweep -- "facts are
 * per-crate"), copies it to `receiving/<intake-id>/`, computes its dock
 * verdict for the CLI's completion message (recomputed, never stored -- see
 * this module's doc comment), and appends `skill.received`. No idempotency
 * key: two receives of the same crate are two distinct dock arrivals, never
 * a duplicate to collapse (same reasoning as `skill.field_report`/
 * `skill.shipped`).
 */
export const receiveCrate = Effect.fn("Receive.receiveCrate")(function* (input: ReceiveCrateInput) {
  const fs = yield* FileSystem;

  const exists = yield* fs
    .exists(input.sourcePath)
    .pipe(Effect.mapError(toIOError(`could not check ${input.sourcePath}`)));
  if (!exists) {
    return yield* Effect.fail(ReceivePathNotFoundError.make({ path: input.sourcePath }));
  }

  const stat = yield* fs
    .stat(input.sourcePath)
    .pipe(Effect.mapError(toIOError(`could not stat ${input.sourcePath}`)));
  if (stat.type !== "Directory") {
    return yield* Effect.fail(ReceivePathNotDirectoryError.make({ path: input.sourcePath }));
  }

  const skillMdExists = yield* fs
    .exists(join(input.sourcePath, "SKILL.md"))
    .pipe(Effect.mapError(toIOError(`could not check ${input.sourcePath}/SKILL.md`)));
  if (!skillMdExists) {
    return yield* Effect.fail(ReceiveNotASkillError.make({ path: input.sourcePath }));
  }

  const intake = newIntakeId();
  const receivingRoot = join(input.workspaceRoot, "receiving");
  const receivedDir = join(receivingRoot, intake);

  yield* fs
    .makeDirectory(receivingRoot, { recursive: true })
    .pipe(Effect.mapError(toIOError(`could not create ${receivingRoot}`)));
  yield* fs
    .copy(input.sourcePath, receivedDir)
    .pipe(Effect.mapError(toIOError(`could not copy ${input.sourcePath} to ${receivedDir}`)));

  const computedHash = yield* hashReceivedCrate(receivedDir);

  // `IndexServiceLayer` (below) is self-sufficient about creating its own
  // `.skillmaker/` directory before opening `studio.db` (`IndexService.ts`'s
  // `layer()`) -- no need to pre-create it here.
  const journal = yield* Journal;
  const events = yield* journal.readAll();
  const registry = yield* gatherIntakeRegistry(events).pipe(
    Effect.provide(IndexServiceLayer(input.workspaceRoot)),
  );
  const verdict = deriveIntakeVerdict(computedHash, input.claimedName, registry);

  yield* journal.append({
    type: "skill.received",
    actor: input.actor,
    payload: {
      intake,
      source: input.source,
      ...(input.ref !== undefined ? { ref: input.ref } : {}),
      ...(input.claimedName !== undefined ? { claimedName: input.claimedName } : {}),
      ...(input.claimedVersionHash !== undefined ? { claimedVersionHash: input.claimedVersionHash } : {}),
      ...(input.rights !== undefined ? { rights: input.rights } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });

  return { intake, receivedDir, verdict } satisfies ReceiveCrateResult;
});
