/**
 * `skillmaker adopt` — brownfield import (strategy-skills-repo-mode.md §3B,
 * plan.md Phase 16). Discovers pre-existing `SKILL.md` files anywhere under a
 * workspace root and wraps each containing directory AS a bundle IN PLACE:
 * no files are moved. This is the "runs on top, doesn't take over" ruling
 * (§3B.8) — Skillmaker adds a `bundle.json` + `.skillmaker-adopt.json`
 * marker to the discovered directory and leaves the rest of the repo's
 * layout (and its own manifests) untouched.
 *
 * A bundle produced this way has layout `"in-place"`: its "output" is the
 * discovered directory's own contents, minus the studio-owned files this
 * module adds (`bundle.json`, the marker, `design.md`, `research/`,
 * `evals/`, `runs/` — the same names `WorkspaceService.createBundle` would
 * have scaffolded for an in-workspace bundle). `Versions.ts` hashes that
 * exclusion set for any bundle carrying the marker; `IndexService.ts` scans
 * for marker-bearing directories anywhere in the workspace (not just under
 * `config.skillsDir`), since adopted bundles are not moved there.
 *
 * Idempotent by construction: discovery skips any directory that already has
 * a `bundle.json` (adopted-in-a-prior-run, or a bundle the workspace already
 * knows about some other way), so a re-run only ever adds newly appeared
 * `SKILL.md` files.
 */
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { basename, dirname, join, relative, sep } from "node:path";
import { BundleIdentity } from "./Bundle.ts";
import { writeDossierScaffold } from "./Dossier.ts";
import { WorkspaceIOError } from "./Errors.ts";
import { classifyIntakeEvidence, type IntakeEvidence, type IntakeRegistry } from "./Receive.ts";
import { ADOPT_EXCLUDED_NAMES, ADOPT_MARKER_FILENAME, hashOutputTree, WORKSPACE_SCAN_SKIP_DIR_NAMES } from "./Versions.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** Directory names never descended into during discovery (§3B.1) -- shared with `IndexService.ts`'s bundle scan (`Versions.ts`'s `WORKSPACE_SCAN_SKIP_DIR_NAMES`), not an independent copy. */
const SKIP_DIR_NAMES: ReadonlySet<string> = WORKSPACE_SCAN_SKIP_DIR_NAMES;

/** Marker for a SKILL.md that is compiler output, not hand-authored (§3B.5b, gstack). */
const GENERATED_MARKER_PATTERN = /AUTO-GENERATED/i;

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

/** kebab-case slug -> "Title Cased Name". Mirrors WorkspaceService's helper. */
const titleCaseFromSlug = (slug: string): string =>
  slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/**
 * kebab-case fold, exported for `Route.ts` (issue #91): `Route.ts` already
 * imports `adoptDirectoryInPlace` from this module (and `gatherIntakeRegistry`/
 * `hashReceivedCrate` from `Receive.ts`), so the cross-module dependency this
 * duplicate would otherwise avoid already exists there -- a third local copy
 * would only add drift risk with no coupling saved. `Receive.ts` keeps its own
 * separate copy: it has no other dependency on this module, so a fresh import
 * just to share four lines would be the worse trade for it specifically.
 */
export const slugify = (name: string): string => {
  const lowered = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return lowered.length > 0 ? lowered : "skill";
};

const uniqueSlug = (base: string, used: ReadonlySet<string>): string => {
  if (!used.has(base)) {
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) {
    n++;
  }
  return `${base}-${n}`;
};

// ---------------------------------------------------------------------------
// Frontmatter — permissive parse, preserve unknown keys (§3B.3)
// ---------------------------------------------------------------------------

export type FrontmatterValue = string | boolean | ReadonlyArray<string>;
export type Frontmatter = Readonly<Record<string, FrontmatterValue>>;

const STANDARD_FRONTMATTER_KEYS: ReadonlySet<string> = new Set(["name", "description"]);

const stripQuotes = (value: string): string => {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

export interface ParsedFrontmatter {
  readonly data: Frontmatter;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * A small, deliberately permissive YAML-frontmatter-block reader: it parses
 * enough of the four verified target repos' frontmatter (plain scalars,
 * `[a, b]` inline arrays, `- item` block arrays, bare booleans) to preserve
 * every key it sees, including nonstandard ones (`disable-model-invocation`,
 * `preamble-tier`, `triggers`, `allowed-tools`, per-skill `version`, §3B.3).
 * It is not a general YAML parser and never rejects — malformed lines are
 * skipped, not thrown.
 */
/**
 * Some generated SKILL.md files (gstack) lead with an HTML comment banner
 * ("<!-- AUTO-GENERATED ... -->") before the frontmatter block. Strip a
 * single leading comment so the `^---` anchor below still finds it.
 */
const LEADING_COMMENT_PATTERN = /^<!--[\s\S]*?-->\s*\n?/;

export const parseFrontmatter = (content: string): ParsedFrontmatter => {
  const withoutLeadingComment = content.replace(LEADING_COMMENT_PATTERN, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(withoutLeadingComment);
  if (match === null) {
    return { data: {}, warnings: ["no frontmatter block found (expected a leading `---` YAML block)"] };
  }

  const body = match[1] ?? "";
  const lines = body.split(/\r?\n/);
  const data: Record<string, FrontmatterValue> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i++;
    if (line === undefined || line.trim().length === 0 || line.trimStart().startsWith("#")) {
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    if (key.length === 0) {
      continue;
    }
    const rawValue = line.slice(colonIndex + 1).trim();

    if (rawValue.length === 0) {
      // Possible block list on following lines: "  - item".
      const items: string[] = [];
      while (i < lines.length) {
        const next = lines[i];
        if (next === undefined || !next.trim().startsWith("- ")) {
          break;
        }
        items.push(stripQuotes(next.trim().slice(2).trim()));
        i++;
      }
      data[key] = items;
      continue;
    }

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      const inner = rawValue.slice(1, -1).trim();
      data[key] = inner.length === 0 ? [] : inner.split(",").map((part) => stripQuotes(part.trim()));
      continue;
    }

    if (rawValue === "true" || rawValue === "false") {
      data[key] = rawValue === "true";
      continue;
    }

    data[key] = stripQuotes(rawValue);
  }

  const warnings: string[] = [];
  for (const key of Object.keys(data)) {
    if (!STANDARD_FRONTMATTER_KEYS.has(key)) {
      warnings.push(`nonstandard frontmatter key "${key}" preserved, not applied`);
    }
  }

  return { data, warnings };
};

const stringField = (data: Frontmatter, key: string): string | undefined => {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export type SkillLifecycle = "archived" | "idea";

const pathSegments = (relativePath: string): ReadonlyArray<string> => relativePath.split(sep);

/**
 * `deprecated/` -> archived, `in-progress/` -> idea (with a note) (§3B.4).
 * Checked over every path segment, not just the immediate parent. Exported
 * (issue #92): `Triage.ts`'s `--from-manifest` execution applies the same
 * pathname rule per row -- a kept row under `deprecated/` still enters
 * archived, exactly as the sweep would have ruled.
 */
export const lifecycleFromPath = (relativePath: string): { readonly lifecycle: SkillLifecycle; readonly note?: string } => {
  const segments = pathSegments(relativePath).map((segment) => segment.toLowerCase());
  if (segments.includes("deprecated")) {
    return { lifecycle: "archived", note: "adopted from a \"deprecated/\" directory" };
  }
  if (segments.includes("in-progress")) {
    return { lifecycle: "idea", note: "adopted from an \"in-progress/\" directory — likely unfinished" };
  }
  return { lifecycle: "idea" };
};

export interface ManifestDetection {
  readonly relativePath: string;
  readonly kind: string;
}

export interface EvalInfraDetection {
  readonly relativePath: string;
  readonly kind: "evals" | "tests";
}

/** One filesystem walk gathers everything discovery needs: SKILL.md files, existing bundle.json slugs (for collision avoidance), manifest files, `.agents/skills` dirs, and eval/test infra dirs. */
export interface WalkResult {
  readonly skillMdFiles: ReadonlyArray<string>;
  readonly existingSlugs: ReadonlySet<string>;
  readonly manifests: ReadonlyArray<ManifestDetection>;
  readonly evalInfra: ReadonlyArray<EvalInfraDetection>;
  readonly warnings: ReadonlyArray<string>;
}

const MANIFEST_BASENAMES: ReadonlySet<string> = new Set(["marketplace.json", "plugin.json"]);

const manifestKindFor = (relativePath: string): string => {
  const dir = basename(dirname(relativePath));
  const file = basename(relativePath);
  if (dir === ".claude-plugin") return `claude-plugin/${file}`;
  if (dir === ".codex-plugin") return `codex-plugin/${file}`;
  if (relativePath.startsWith(join(".agents", "plugins"))) return `agents-plugins/${file}`;
  return file;
};

/**
 * Exported (issue #92): `Triage.ts`'s `--triage` sweep runs this exact same
 * read-only discovery walk -- "the existing discovery sweep" the issue
 * calls for -- rather than a second, drifting copy. `adoptWorkspace` (below)
 * is the only thing that turns a `WalkResult` into filesystem writes;
 * `walk` itself never touches anything.
 */
export const walk = Effect.fn("Adopt.walk")(function* (root: string) {
  const fs = yield* FileSystem;

  const skillMdFiles: string[] = [];
  const existingSlugs = new Set<string>();
  const manifests: ManifestDetection[] = [];
  const evalInfra: EvalInfraDetection[] = [];
  const warnings: string[] = [];

  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) {
      continue;
    }
    const entries = yield* fs
      .readDirectory(dir)
      .pipe(Effect.mapError(toIOError(`could not list ${dir}`)));

    for (const entry of entries) {
      const full = join(dir, entry);
      const info = yield* fs.stat(full).pipe(Effect.mapError(toIOError(`could not stat ${full}`)));

      if (info.type === "Directory") {
        if (SKIP_DIR_NAMES.has(entry)) {
          continue;
        }
        if (entry === "evals" || entry === "tests") {
          evalInfra.push({ relativePath: relative(root, full), kind: entry });
        }
        stack.push(full);
        continue;
      }

      if (info.type !== "File") {
        continue;
      }

      if (entry === "SKILL.md") {
        skillMdFiles.push(full);
        continue;
      }

      if (entry === "bundle.json") {
        const outcome = yield* Effect.result(
          fs.readFileString(full).pipe(
            Effect.flatMap((raw) => Effect.try({ try: () => JSON.parse(raw) as unknown, catch: (cause) => cause })),
            Effect.flatMap((parsed) => Schema.decodeUnknownEffect(BundleIdentity)(parsed)),
          ),
        );
        if (outcome._tag === "Success") {
          existingSlugs.add(outcome.success.slug);
        } else {
          warnings.push(`${relative(root, full)} is malformed and was not read for slug collision checks`);
        }
        continue;
      }

      if (MANIFEST_BASENAMES.has(entry)) {
        const relativePath = relative(root, full);
        manifests.push({ relativePath, kind: manifestKindFor(relativePath) });
      }
    }
  }

  return { skillMdFiles: skillMdFiles.sort(), existingSlugs, manifests, evalInfra, warnings };
});

// ---------------------------------------------------------------------------
// Adopt
// ---------------------------------------------------------------------------

/**
 * Fix (Phase 20 Story 3 friction log, upstream provenance): when `adopt` is
 * run with `--source <url-or-path>`, every skill adopted in THAT batch
 * records where it came from. Deliberately minimal (record-only) — no
 * drift-vs-upstream comparison is computed or implied by this field; that's
 * future work once there's a real need to re-diff against the origin.
 */
export class AdoptUpstream extends Schema.Class<AdoptUpstream>("AdoptUpstream")({
  /** Whatever the operator passed to `--source` — a URL or a local path, not validated or normalized. */
  source: Schema.String,
  /** Optional `--ref` (a git ref, tag, or any other origin-specific pointer the operator wants recorded alongside `source`). */
  ref: Schema.optionalKey(Schema.String),
  importedAt: Schema.String,
}) {}

/** Recorded in `.skillmaker-adopt.json` — the in-place layout marker (§3B.8). */
export class AdoptMarker extends Schema.Class<AdoptMarker>("AdoptMarker")({
  schemaVersion: Schema.Literal(1),
  adoptedAt: Schema.String,
  layout: Schema.Literal("in-place"),
  skillPath: Schema.String,
  generated: Schema.Boolean,
  frontmatter: Schema.Record(
    Schema.String,
    Schema.Union([Schema.String, Schema.Boolean, Schema.Array(Schema.String)]),
  ),
  /** `optionalKey` so pre-fix markers still decode; absent means "not recorded", not "no upstream". */
  upstream: Schema.optionalKey(AdoptUpstream),
  /**
   * `route --as fork` (issue #91, `Mechanism - Receiving Dock.md` §HOW):
   * the parent bundle's slug, when this bundle was minted by forking an
   * arriving crate off of an existing one -- "shared ancestry, diverged
   * intent." Lives here, not on `skill.routed`'s journal payload: provenance
   * that isn't a per-event fact about the routing decision itself (like
   * `AdoptUpstream.source`/`ref` above) belongs on the bundle's own marker,
   * same house law. `optionalKey` so every marker written before #91 (and
   * every non-forked bundle after it) still decodes with no `forkOf` at all.
   */
  forkOf: Schema.optionalKey(Schema.String),
}) {}

export interface AdoptedSkill {
  readonly slug: string;
  readonly dir: string;
  readonly relativePath: string;
  readonly lifecycle: SkillLifecycle;
  readonly generated: boolean;
  readonly warnings: ReadonlyArray<string>;
}

export interface SkippedSkill {
  readonly relativePath: string;
  readonly reason: "already-adopted";
}

/**
 * A candidate the registry/paperwork tripwire caught (issue #92, `Mechanism
 * - Receiving Dock.md` §HOW: "challenges provable arrivals found under
 * adopt -- evidence surfaced, human decides, never enforced"): NOT written
 * to disk, NOT adopted -- the human routes it via `skillmaker receive` or
 * `adopt --triage` instead.
 */
export interface ChallengedSkill {
  readonly relativePath: string;
  readonly evidence: IntakeEvidence;
}

export interface AdoptReport {
  readonly found: number;
  readonly adopted: ReadonlyArray<AdoptedSkill>;
  readonly skipped: ReadonlyArray<SkippedSkill>;
  /** Evidence-bearing candidates the tripwire challenged instead of silently adopting (empty unless `options.registry` was passed). */
  readonly challenged: ReadonlyArray<ChallengedSkill>;
  readonly warnings: ReadonlyArray<string>;
  readonly manifests: ReadonlyArray<ManifestDetection>;
  readonly evalInfra: ReadonlyArray<EvalInfraDetection>;
}

export interface AdoptWorkspaceOptions {
  /**
   * Fix (Phase 20 Story 3 friction log, upstream provenance): `adopt
   * --source <url-or-path>` — recorded on every skill adopted in THIS
   * batch's `.skillmaker-adopt.json` marker as `upstream.source`. Omitted
   * entirely (no `upstream` key at all) when not passed, so ordinary adopts
   * are unaffected.
   */
  readonly source?: string;
  /** `adopt --source ... --ref <ref>` — ignored if `source` is absent. */
  readonly ref?: string;
  /**
   * The registry/paperwork tripwire (issue #92): when provided, every
   * candidate is hash- and name-checked against it before being adopted
   * (`classifyIntakeEvidence`, `Receive.ts`) -- an evidence-bearing
   * candidate (hash-match / name-collision / foreign adopt marker) is
   * reported in `challenged` instead of written to disk. Omitted entirely
   * (the default), adoption behaves exactly as before the tripwire existed
   * -- every existing caller (unit tests, `--triage`'s own read-only sweep,
   * which never adopts anything regardless of this option) is unaffected.
   */
  readonly registry?: IntakeRegistry;
}

export interface AdoptDirectoryUpstream {
  readonly source: string;
  readonly ref?: string;
}

export interface AdoptDirectoryInput {
  /** The directory to wrap in place -- caller has already confirmed it contains a top-level `SKILL.md` (`adoptWorkspace`'s discovery walk; `Route.ts`'s dock crate, `Mechanism - Receiving Dock.md`, issue #91). */
  readonly dir: string;
  /** `SKILL.md`'s content, already read by the caller (discovery reads it to detect the generated-output marker; `Route.ts` reads it after moving the crate). */
  readonly skillMdContent: string;
  /** Preferred base string to slugify before uniquification; falls back to `basename(dir)` (`adoptWorkspace`'s own convention) when omitted. */
  readonly slugBase?: string;
  /** Slugs already spoken for -- `uniqueSlug` appends `-2`, `-3`, ... until it finds one that isn't in this set. */
  readonly usedSlugs: ReadonlySet<string>;
  /** Overrides `bundle.json`'s `name` ahead of `SKILL.md`'s own frontmatter `name:` field -- `adoptWorkspace` never passes this (frontmatter or a title-cased slug decide, as always); `Route.ts`'s `--name` does. */
  readonly nameOverride?: string;
  /** `adopt --source`'s upstream provenance, when this batch/crate came stamped with one. */
  readonly upstream?: AdoptDirectoryUpstream;
  /** `route --as fork`'s parent link (issue #91): the existing bundle this one was forked from, recorded on the marker as `forkOf`. */
  readonly forkOf?: string;
}

export interface AdoptDirectoryResult {
  readonly slug: string;
  readonly name: string;
  readonly generated: boolean;
  /** Frontmatter-parse warnings only (nonstandard keys, missing block) -- lifecycle/generated-marker prose is the caller's own concern, same split `adoptWorkspace`'s loop already made before this was factored out. */
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Wraps ONE already-discovered (or already-moved) skill directory in place:
 * parses `SKILL.md`'s frontmatter (permissive, `parseFrontmatter`), mints a
 * unique slug, writes `bundle.json` + the `.skillmaker-adopt.json` marker
 * (§3B.8) -- exactly the per-skill mechanics `adoptWorkspace`'s discovery
 * loop performs, factored out here so every caller with its own
 * already-known target directory mints the same `bundle.json`/marker pair
 * without reimplementing it: `Route.ts`'s `new`/`fork` dispositions (issue
 * #91) and `Triage.ts`'s `--from-manifest` rows (issue #92) -- one write
 * path, three doors. Does not read `SKILL.md` itself (the caller already
 * has its content one way or another), check for slug collisions beyond
 * `usedSlugs` (what "already adopted" or "slug taken" means differs by
 * caller: a filesystem check for `adoptWorkspace`/the manifest, a
 * workspace-wide registry + directory check for `Route.ts`), or run the
 * registry tripwire (that's `adoptWorkspace`'s pre-check, the one caller
 * where no human has ruled on the candidate yet) -- those stay the
 * caller's job.
 */
export const adoptDirectoryInPlace = Effect.fn("Adopt.adoptDirectoryInPlace")(function* (
  input: AdoptDirectoryInput,
) {
  const fs = yield* FileSystem;

  const { data: frontmatter, warnings: frontmatterWarnings } = parseFrontmatter(input.skillMdContent);
  const generated = GENERATED_MARKER_PATTERN.test(input.skillMdContent);

  const baseSlug = slugify(input.slugBase ?? basename(input.dir));
  const slug = uniqueSlug(baseSlug, input.usedSlugs);

  const identity = BundleIdentity.make({
    schemaVersion: 1,
    slug,
    name: input.nameOverride ?? stringField(frontmatter, "name") ?? titleCaseFromSlug(slug),
    oneLiner: stringField(frontmatter, "description") ?? "",
    tags: [],
    created: todayIsoDate(),
    targets: ["claude-code"],
  });

  const bundleJsonPath = join(input.dir, "bundle.json");
  yield* fs
    .writeFileString(bundleJsonPath, `${JSON.stringify(identity, null, 2)}\n`)
    .pipe(Effect.mapError(toIOError(`could not write ${bundleJsonPath}`)));

  const adoptedAt = new Date().toISOString();
  const marker = AdoptMarker.make({
    schemaVersion: 1,
    adoptedAt,
    layout: "in-place",
    skillPath: "SKILL.md",
    generated,
    frontmatter,
    ...(input.upstream !== undefined
      ? {
          upstream: AdoptUpstream.make({
            source: input.upstream.source,
            ...(input.upstream.ref !== undefined ? { ref: input.upstream.ref } : {}),
            importedAt: adoptedAt,
          }),
        }
      : {}),
    ...(input.forkOf !== undefined ? { forkOf: input.forkOf } : {}),
  });
  yield* fs
    .writeFileString(join(input.dir, ADOPT_MARKER_FILENAME), `${JSON.stringify(marker, null, 2)}\n`)
    .pipe(Effect.mapError(toIOError(`could not write ${ADOPT_MARKER_FILENAME} in ${input.dir}`)));

  // dossier.md scaffold (issue #94): the ONE write path shared by plain
  // `adopt`'s sweep, `Route.ts`'s `new`/`fork` (via `landAndAdopt`), and the
  // triage manifest's per-row `keep`+`mine` execution -- writing it here
  // means all three scaffold it identically, with no separate copy in any
  // of the three callers. Never clobbers an existing `dossier.md` (a
  // foreign arrival, or a re-adopt, may already carry one).
  yield* writeDossierScaffold(input.dir, slug, identity.name);

  return {
    slug,
    name: identity.name,
    generated,
    warnings: frontmatterWarnings,
  } satisfies AdoptDirectoryResult;
});

/**
 * Discovers and wraps every not-yet-adopted `SKILL.md` under `root` as an
 * in-place bundle (§3B.1-§3B.6, §3B.8). Filesystem-only: does not touch the
 * journal — callers (the CLI command) fold `AdoptedSkill`s into
 * `bundle.created` / `bundle.archived` / `skill.version_recorded` events,
 * mirroring how `New.ts` layers journal writes on top of
 * `Workspace.createBundle`.
 */
export const adoptWorkspace = Effect.fn("Adopt.adoptWorkspace")(function* (
  root: string,
  options: AdoptWorkspaceOptions = {},
) {
  const fs = yield* FileSystem;

  const { skillMdFiles, existingSlugs, manifests, evalInfra, warnings: walkWarnings } = yield* walk(root);

  const adopted: AdoptedSkill[] = [];
  const skipped: SkippedSkill[] = [];
  const challenged: ChallengedSkill[] = [];
  const warnings: string[] = [...walkWarnings];
  const usedSlugs = new Set(existingSlugs);

  for (const skillMdPath of skillMdFiles) {
    const dir = dirname(skillMdPath);
    const relativePath = relative(root, dir);
    const bundleJsonPath = join(dir, "bundle.json");

    const alreadyAdopted = yield* fs
      .exists(bundleJsonPath)
      .pipe(Effect.mapError(toIOError(`could not check ${bundleJsonPath}`)));
    if (alreadyAdopted) {
      skipped.push({ relativePath, reason: "already-adopted" });
      continue;
    }

    const content = yield* fs
      .readFileString(skillMdPath)
      .pipe(Effect.mapError(toIOError(`could not read ${skillMdPath}`)));

    // The registry/paperwork tripwire (issue #92): only runs when a
    // registry was supplied -- omitted entirely for callers that already
    // decided (a `--from-manifest` row, `Route.ts`'s human-ruled
    // dispositions) or that never write at all (`--triage`'s read-only
    // sweep). A challenged candidate's slug is deliberately never added to
    // `usedSlugs`: it was never adopted, so it must not shadow a later,
    // genuinely bare candidate that happens to slugify the same way. The
    // frontmatter parse here repeats inside `adoptDirectoryInPlace` for the
    // candidates that pass -- a small, pure re-read traded for keeping the
    // tripwire out of the one shared write path Route.ts also calls.
    if (options.registry !== undefined) {
      const { data: frontmatter } = parseFrontmatter(content);
      const prospectiveSlug = uniqueSlug(slugify(basename(dir)), usedSlugs);
      const claimedName = stringField(frontmatter, "name") ?? titleCaseFromSlug(prospectiveSlug);
      const markerExists = yield* fs
        .exists(join(dir, ADOPT_MARKER_FILENAME))
        .pipe(Effect.mapError(toIOError(`could not check ${join(dir, ADOPT_MARKER_FILENAME)}`)));
      const computedHash = yield* hashOutputTree(dir, { excludeTopLevel: ADOPT_EXCLUDED_NAMES });
      const evidence = classifyIntakeEvidence(computedHash, claimedName, markerExists, options.registry);
      if (evidence.kind !== "bare") {
        challenged.push({ relativePath, evidence });
        continue;
      }
    }

    const { lifecycle, note } = lifecycleFromPath(relativePath);

    const wrapped = yield* adoptDirectoryInPlace({
      dir,
      skillMdContent: content,
      slugBase: basename(dir),
      usedSlugs,
      ...(options.source !== undefined
        ? { upstream: { source: options.source, ...(options.ref !== undefined ? { ref: options.ref } : {}) } }
        : {}),
    });
    usedSlugs.add(wrapped.slug);

    const skillWarnings: string[] = [...wrapped.warnings];
    if (wrapped.generated) {
      skillWarnings.push(
        "SKILL.md appears to be generated output (an \"AUTO-GENERATED\" marker was found) — imported as-is, flagged rather than treated as hand-authored source",
      );
    }
    if (note !== undefined) {
      skillWarnings.push(note);
    }

    adopted.push({
      slug: wrapped.slug,
      dir,
      relativePath,
      lifecycle,
      generated: wrapped.generated,
      warnings: skillWarnings,
    });
  }

  return {
    found: skillMdFiles.length,
    adopted,
    skipped,
    challenged,
    warnings,
    manifests,
    evalInfra,
  } satisfies AdoptReport;
});

export { ADOPT_EXCLUDED_NAMES, ADOPT_MARKER_FILENAME } from "./Versions.ts";
