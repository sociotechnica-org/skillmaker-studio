/**
 * `skill.routed` -- the five exit doors out of the Receiving Dock (issue
 * #91, `Mechanism - Receiving Dock.md` §HOW): "the review.requested/
 * review.resolved pairing applied to cargo." An undisposed crate is a
 * `skill.received` with no `skill.routed` pointing at it (`Receive.ts`'s
 * `listUndisposedIntake`); `routeCrate` is the routing engine that closes
 * that loop -- one function per disposition below, each mapping to existing
 * primitives rather than reimplementing them:
 *
 *  - `return`: no file movement at all -- we already hold this content
 *    under an existing bundle. The routing fact (and a hash-match proof) is
 *    the whole story.
 *  - `new`/`fork`: the crate directory MOVES `receiving/<intake>/` ->
 *    `skills/<slug>/` (a true `fs.rename`, not copy+delete -- the crate
 *    becomes the bundle, it doesn't get duplicated), then
 *    `Adopt.ts`'s `adoptDirectoryInPlace` mints `bundle.json` + the
 *    `.skillmaker-adopt.json` marker exactly the way brownfield adoption
 *    does -- reused, not reimplemented. `fork` additionally stamps the
 *    marker's `forkOf` link.
 *  - `upgrade`: the crate's content lands IN an existing bundle's output
 *    (replacing it), and `Versions.ts`'s `recordSkillVersion` is called --
 *    the exact same primitive `adopt`/`version record` already use.
 *  - `salvage`: no identity granted, no file movement -- the crate stays at
 *    the dock, un-accessioned, retained as evidence. Only the routing fact
 *    is appended.
 *
 * Idempotency (issue #91): re-routing an already-routed intake with the
 * IDENTICAL disposition is a no-op (`alreadyRouted: true`, no new event);
 * a different disposition is `RouteAlreadyRoutedError`. This guard reads the
 * fold (a `find` over `events`), the same "guard reads the journal, not a
 * generic key comparison" shape `Machine.ts`'s `checkTransition` uses for
 * the review-pair guard this event type mirrors -- not `Journal.append`'s
 * generic `idempotencyKey` mechanism (`skill.routed` carries none).
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { adoptDirectoryInPlace, slugify } from "./Adopt.ts";
import type { Actor } from "./Actor.ts";
import type { BundleStage } from "./Bundle.ts";
import {
  RouteAlreadyRoutedError,
  RouteBundleNotFoundError,
  RouteIntakeNotFoundError,
  RouteNoHashMatchError,
  RouteSlugCollisionError,
  WorkspaceIOError,
} from "./Errors.ts";
import { layer as IndexServiceLayer } from "./IndexService.ts";
import type { JournalEvent, RouteDisposition, SkillReceivedEvent, SkillRoutedEvent } from "./Journal.ts";
import { Journal } from "./JournalService.ts";
import { findReceivedEvent, gatherIntakeRegistry, hashReceivedCrate, type IntakeRegistry } from "./Receive.ts";
import {
  ADOPT_EXCLUDED_NAMES,
  computeBundleHashes,
  detectBundleLayout,
  foldSkillVersions,
  recordSkillVersion,
  type BundleLayout,
} from "./Versions.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** The five dispositions, in the order the design doc lists them -- mirrors `Fixtures.ts`'s `FIXTURE_CLASSES`/`isFixtureClass` pattern for the CLI's `--as` validation. */
export const DISPOSITIONS: ReadonlyArray<RouteDisposition> = ["return", "new", "upgrade", "fork", "salvage"];

/** Type guard for `--as` values arriving as raw strings from argv. */
export const isRouteDisposition = (value: string): value is RouteDisposition =>
  (DISPOSITIONS as ReadonlyArray<string>).includes(value);

export interface RouteCrateInput {
  readonly workspaceRoot: string;
  /**
   * `resolved.config.skillsDir` -- where `new`/`fork` land a newly minted
   * bundle, and where `return`/`upgrade`/salvage-with-a-target look for the
   * bundle they're routing against, mirroring `Ship.ts`/`StationEngine.ts`'s
   * own `<workspaceRoot>/<skillsDir>/<slug>` convention (an in-place-adopted
   * bundle discovered elsewhere in the workspace is a pre-existing gap
   * those callers already share, not one this module introduces).
   */
  readonly skillsDir: string;
  readonly intake: string;
  readonly disposition: RouteDisposition;
  /**
   * `return`/`upgrade`: the existing bundle the crate is routed against
   * (the CLI requires this before calling in). `new`/`fork`: an optional
   * slug override for the newly minted bundle (derived from `name`/the
   * crate's own claimed name otherwise). `salvage`: an optional bundle
   * being defended -- absent means "no target," the one disposition
   * allowed to omit `bundle` on the routing event entirely.
   */
  readonly bundle?: string;
  /** `fork` only (the CLI requires this): the existing bundle this one is forked from -- recorded on the new bundle's marker as `forkOf`. */
  readonly parent?: string;
  /** `new`/`fork`: display-name override for the minted bundle. `upgrade`: version label override. Ignored by `return`/`salvage`. */
  readonly name?: string;
  /** `new`/`fork` only: entry stage, default `"idea"`. A non-`"idea"` stage is recorded as an honest `override: true` move (issue #91: "working arrivals may enter later stages with the move recorded honestly"). */
  readonly stage?: BundleStage;
  /** The hypothesis (broken? evolved? forked?) -- required on every disposition, no exceptions (`SkillRoutedEvent`'s own doc comment). */
  readonly reason: string;
  readonly actor: Actor;
}

export interface RouteCrateResult {
  readonly intake: string;
  readonly disposition: RouteDisposition;
  readonly bundle?: string;
  /** `true` when this call was a no-op repeat of an already-routed intake with the identical disposition. */
  readonly alreadyRouted: boolean;
  /** `new`/`fork`: the newly minted slug (equal to `bundle` above -- restated for callers that only care about this branch). */
  readonly slug?: string;
  /** `fork` only: the parent bundle slug. */
  readonly parent?: string;
  /** `new`/`fork`/`upgrade`: the newly recorded version's output-tree hash. */
  readonly versionHash?: string;
}

interface RouteContext {
  readonly input: RouteCrateInput;
  readonly crateDir: string;
  readonly registry: IntakeRegistry;
  readonly received: SkillReceivedEvent;
}

const bundleDirFor = (ctx: RouteContext, slug: string): string =>
  join(ctx.input.workspaceRoot, ctx.input.skillsDir, slug);

const bundleKnown = (ctx: RouteContext, slug: string): boolean =>
  ctx.registry.bundles.some((bundle) => bundle.slug === slug);

/**
 * `return`/`fork`/`upgrade`'s "a specific, already-known bundle" guard --
 * `return`/`upgrade`'s `--bundle` and `fork`'s `--parent` are all the same
 * requirement (a real value naming a bundle the registry actually knows
 * about), so this is the one place that check lives instead of three
 * near-identical repeats. Defensive only -- the CLI already requires the
 * flag before ever calling in; an undefined/unknown value never matches a
 * real slug, so this still resolves to an honest error rather than a crash
 * if it's ever reached some other way.
 */
const requireKnownBundle = Effect.fn("Route.requireKnownBundle")(function* (
  ctx: RouteContext,
  bundle: string | undefined,
) {
  if (bundle === undefined || !bundleKnown(ctx, bundle)) {
    return yield* Effect.fail(RouteBundleNotFoundError.make({ bundle: bundle ?? "" }));
  }
  return bundle;
});

/** `new`/`fork`'s slug-collision guard (issue #91's honest error list: "slug collision on new/fork"): checked two ways -- against the workspace-wide registry (a known bundle living anywhere, in-place or not) and against the literal target directory (a stray, not-yet-indexed directory already sitting where this bundle would land). */
const guardSlugAvailable = Effect.fn("Route.guardSlugAvailable")(function* (ctx: RouteContext, slug: string) {
  if (bundleKnown(ctx, slug)) {
    return yield* Effect.fail(RouteSlugCollisionError.make({ slug }));
  }
  const fs = yield* FileSystem;
  const bundleDir = bundleDirFor(ctx, slug);
  const exists = yield* fs.exists(bundleDir).pipe(Effect.mapError(toIOError(`could not check ${bundleDir}`)));
  if (exists) {
    return yield* Effect.fail(RouteSlugCollisionError.make({ slug }));
  }
});

interface LandAndAdoptResult {
  readonly slug: string;
  readonly bundleDir: string;
  readonly designHash: string;
  readonly outputHash: string;
}

/**
 * The shared `new`/`fork` mechanics: mint the target slug, move the crate
 * directory into place (`fs.rename` -- the crate BECOMES the bundle), wrap
 * it in place via `Adopt.ts`'s `adoptDirectoryInPlace` (reused, not
 * reimplemented), append `bundle.created` (+ an honest `override: true`
 * `bundle.stage_changed` when `--stage` names anything past `"idea"`), and
 * record its first version. `fork` is `new` plus `options.forkOf` threaded
 * onto the marker -- the only difference in this shared path.
 */
const landAndAdopt = Effect.fn("Route.landAndAdopt")(function* (
  ctx: RouteContext,
  options: { readonly forkOf?: string; readonly versionLabel: string },
) {
  const fs = yield* FileSystem;

  const desiredName = ctx.input.name ?? ctx.received.payload.claimedName ?? "Skill";
  const slug = slugify(ctx.input.bundle ?? desiredName);
  yield* guardSlugAvailable(ctx, slug);

  const bundleDir = bundleDirFor(ctx, slug);
  // `fs.rename` requires the destination's PARENT to already exist (unlike
  // `adoptWorkspace`'s in-place wrap, which never moves anything) -- a
  // workspace whose very first bundle is minted this way has no
  // `skills/` directory yet.
  yield* fs
    .makeDirectory(join(ctx.input.workspaceRoot, ctx.input.skillsDir), { recursive: true })
    .pipe(Effect.mapError(toIOError(`could not create ${join(ctx.input.workspaceRoot, ctx.input.skillsDir)}`)));
  yield* fs
    .rename(ctx.crateDir, bundleDir)
    .pipe(Effect.mapError(toIOError(`could not move ${ctx.crateDir} to ${bundleDir}`)));

  const skillMdPath = join(bundleDir, "SKILL.md");
  const skillMdContent = yield* fs
    .readFileString(skillMdPath)
    .pipe(Effect.mapError(toIOError(`could not read ${skillMdPath}`)));

  const wrapped = yield* adoptDirectoryInPlace({
    dir: bundleDir,
    skillMdContent,
    slugBase: slug,
    usedSlugs: new Set(ctx.registry.bundles.map((bundle) => bundle.slug)),
    ...(ctx.input.name !== undefined ? { nameOverride: ctx.input.name } : {}),
    upstream: {
      source: ctx.received.payload.source,
      ...(ctx.received.payload.ref !== undefined ? { ref: ctx.received.payload.ref } : {}),
    },
    ...(options.forkOf !== undefined ? { forkOf: options.forkOf } : {}),
  });

  const journal = yield* Journal;
  yield* journal.append({
    type: "bundle.created",
    actor: ctx.input.actor,
    idempotencyKey: `bundle.created:${wrapped.slug}`,
    payload: { bundle: wrapped.slug },
  });

  const targetStage = ctx.input.stage ?? "idea";
  if (targetStage !== "idea") {
    yield* journal.append({
      type: "bundle.stage_changed",
      actor: ctx.input.actor,
      payload: {
        bundle: wrapped.slug,
        from: "idea",
        to: targetStage,
        reason: ctx.input.reason,
        override: true,
      },
    });
  }

  const { designHash, outputHash } = yield* computeBundleHashes(bundleDir, "in-place");
  yield* recordSkillVersion(wrapped.slug, ctx.input.actor, designHash, outputHash, {
    label: options.versionLabel,
  });

  return { slug: wrapped.slug, bundleDir, designHash, outputHash } satisfies LandAndAdoptResult;
});

/**
 * `upgrade`'s content-landing step: the crate's content REPLACES the
 * existing bundle's payload -- an `output-dir` bundle gets its `output/`
 * cleared then re-copied from the crate; an `in-place` bundle has every
 * top-level entry NOT in `ADOPT_EXCLUDED_NAMES` (the studio-owned files
 * `bundle.json`/the marker/`design.md`/`research/`/`evals/`/`runs/`, the
 * same exclusion set `Adopt.ts`/`Versions.ts` already use for hashing)
 * cleared and replaced from the crate's own equivalent entries -- never
 * touching the studio-owned files either side carries.
 */
const landCrateContent = Effect.fn("Route.landCrateContent")(function* (
  crateDir: string,
  bundleDir: string,
  layout: BundleLayout,
) {
  const fs = yield* FileSystem;

  if (layout === "output-dir") {
    const outputDir = join(bundleDir, "output");
    yield* fs
      .remove(outputDir, { recursive: true, force: true })
      .pipe(Effect.mapError(toIOError(`could not clear ${outputDir}`)));
    yield* fs
      .copy(crateDir, outputDir)
      .pipe(Effect.mapError(toIOError(`could not copy ${crateDir} to ${outputDir}`)));
    return;
  }

  const bundleEntries = yield* fs
    .readDirectory(bundleDir)
    .pipe(Effect.mapError(toIOError(`could not list ${bundleDir}`)));
  for (const entry of bundleEntries) {
    if (ADOPT_EXCLUDED_NAMES.has(entry)) continue;
    const target = join(bundleDir, entry);
    yield* fs.remove(target, { recursive: true, force: true }).pipe(Effect.mapError(toIOError(`could not remove ${target}`)));
  }

  const crateEntries = yield* fs
    .readDirectory(crateDir)
    .pipe(Effect.mapError(toIOError(`could not list ${crateDir}`)));
  for (const entry of crateEntries) {
    if (ADOPT_EXCLUDED_NAMES.has(entry)) continue;
    const from = join(crateDir, entry);
    const to = join(bundleDir, entry);
    yield* fs.copy(from, to, { overwrite: true }).pipe(Effect.mapError(toIOError(`could not copy ${from} to ${to}`)));
  }
});

const appendRouted = Effect.fn("Route.appendRouted")(function* (
  ctx: RouteContext,
  fields: { readonly disposition: RouteDisposition; readonly bundle?: string },
) {
  const journal = yield* Journal;
  yield* journal.append({
    type: "skill.routed",
    actor: ctx.input.actor,
    payload: {
      intake: ctx.input.intake,
      disposition: fields.disposition,
      ...(fields.bundle !== undefined ? { bundle: fields.bundle } : {}),
      reason: ctx.input.reason,
    },
  });
});

/** "return": hash-match proof against a NAMED bundle (not just "some bundle anywhere," the way the dock's own read-time verdict works) -- a human ruling that this is ours, coming home, on a specific bundle. No file movement: we already hold this content. */
const routeReturn = Effect.fn("Route.routeReturn")(function* (
  ctx: RouteContext,
  events: ReadonlyArray<JournalEvent>,
) {
  const bundle = yield* requireKnownBundle(ctx, ctx.input.bundle);

  const computedHash = yield* hashReceivedCrate(ctx.crateDir);
  const versions = foldSkillVersions(events).get(bundle) ?? [];
  const matched = versions.some((version) => version.hash === computedHash);
  if (!matched) {
    return yield* Effect.fail(RouteNoHashMatchError.make({ intake: ctx.input.intake, bundle }));
  }

  yield* appendRouted(ctx, { disposition: "return", bundle });
  const result: RouteCrateResult = {
    intake: ctx.input.intake,
    disposition: "return",
    bundle,
    alreadyRouted: false,
  };
  return result;
});

/** "new": no overlap -- adopt into the corpus with provenance stamped. */
const routeNew = Effect.fn("Route.routeNew")(function* (ctx: RouteContext) {
  const landed = yield* landAndAdopt(ctx, { versionLabel: "received" });
  yield* appendRouted(ctx, { disposition: "new", bundle: landed.slug });
  const result: RouteCrateResult = {
    intake: ctx.input.intake,
    disposition: "new",
    bundle: landed.slug,
    slug: landed.slug,
    alreadyRouted: false,
    versionHash: landed.outputHash,
  };
  return result;
});

/** "fork": shared ancestry, diverged intent -- new bundle, provenance link to the parent (`--parent`, required). */
const routeFork = Effect.fn("Route.routeFork")(function* (ctx: RouteContext) {
  const parent = yield* requireKnownBundle(ctx, ctx.input.parent);

  const landed = yield* landAndAdopt(ctx, { forkOf: parent, versionLabel: "forked" });
  yield* appendRouted(ctx, { disposition: "fork", bundle: landed.slug });
  const result: RouteCrateResult = {
    intake: ctx.input.intake,
    disposition: "fork",
    bundle: landed.slug,
    slug: landed.slug,
    parent,
    alreadyRouted: false,
    versionHash: landed.outputHash,
  };
  return result;
});

/** "upgrade": same name, different content, hypothesis evolved -- the crate's content becomes the existing bundle's next recorded version. */
const routeUpgrade = Effect.fn("Route.routeUpgrade")(function* (ctx: RouteContext) {
  const bundle = yield* requireKnownBundle(ctx, ctx.input.bundle);

  const bundleDir = bundleDirFor(ctx, bundle);
  const layout = yield* detectBundleLayout(bundleDir);
  yield* landCrateContent(ctx.crateDir, bundleDir, layout);

  const { designHash, outputHash } = yield* computeBundleHashes(bundleDir, layout);
  const label = ctx.input.name ?? ctx.received.payload.claimedVersionHash ?? ctx.received.payload.claimedName;
  yield* recordSkillVersion(bundle, ctx.input.actor, designHash, outputHash, label !== undefined ? { label } : {});

  yield* appendRouted(ctx, { disposition: "upgrade", bundle });
  const result: RouteCrateResult = {
    intake: ctx.input.intake,
    disposition: "upgrade",
    bundle,
    alreadyRouted: false,
    versionHash: outputHash,
  };
  return result;
});

/** "salvage": hypothesis broken -- no identity granted, no file movement. The crate stays at the dock, un-accessioned, retained as evidence; `--bundle`, when given, names the existing bundle being defended (its work order becomes a manually-opened todo, `TodoFromReport.ts`'s `openTodoFromIntake`). */
const routeSalvage = Effect.fn("Route.routeSalvage")(function* (ctx: RouteContext) {
  const bundle = ctx.input.bundle;
  if (bundle !== undefined && !bundleKnown(ctx, bundle)) {
    return yield* Effect.fail(RouteBundleNotFoundError.make({ bundle }));
  }

  yield* appendRouted(ctx, { disposition: "salvage", ...(bundle !== undefined ? { bundle } : {}) });
  const result: RouteCrateResult = {
    intake: ctx.input.intake,
    disposition: "salvage",
    ...(bundle !== undefined ? { bundle } : {}),
    alreadyRouted: false,
  };
  return result;
});

/**
 * Routes one dock crate through one of the five exit doors (issue #91).
 * Reads the journal once for the intake/idempotency lookups, gathers the
 * SAME workspace-wide registry `Receive.ts`'s own dock verdict uses
 * (`gatherIntakeRegistry` -- bundle slugs/names + every recorded hash), then
 * dispatches to one disposition-specific function above.
 */
export const routeCrate = Effect.fn("Route.routeCrate")(function* (input: RouteCrateInput) {
  const journal = yield* Journal;
  const events = yield* journal.readAll();

  const received = findReceivedEvent(events, input.intake);
  if (received === undefined) {
    return yield* Effect.fail(RouteIntakeNotFoundError.make({ intake: input.intake }));
  }

  const existingRouting = events.find(
    (event): event is SkillRoutedEvent => event.type === "skill.routed" && event.payload.intake === input.intake,
  );
  if (existingRouting !== undefined) {
    if (existingRouting.payload.disposition === input.disposition) {
      const result: RouteCrateResult = {
        intake: input.intake,
        disposition: input.disposition,
        alreadyRouted: true,
        ...(existingRouting.payload.bundle !== undefined ? { bundle: existingRouting.payload.bundle } : {}),
      };
      return result;
    }
    return yield* Effect.fail(
      RouteAlreadyRoutedError.make({
        intake: input.intake,
        existingDisposition: existingRouting.payload.disposition,
        attemptedDisposition: input.disposition,
      }),
    );
  }

  const registry = yield* gatherIntakeRegistry(events).pipe(Effect.provide(IndexServiceLayer(input.workspaceRoot)));
  const crateDir = join(input.workspaceRoot, "receiving", input.intake);
  const ctx: RouteContext = { input, crateDir, registry, received };

  switch (input.disposition) {
    case "return":
      return yield* routeReturn(ctx, events);
    case "new":
      return yield* routeNew(ctx);
    case "upgrade":
      return yield* routeUpgrade(ctx);
    case "fork":
      return yield* routeFork(ctx);
    case "salvage":
      return yield* routeSalvage(ctx);
  }
});
