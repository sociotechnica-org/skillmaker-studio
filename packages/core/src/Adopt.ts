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
import { WorkspaceIOError } from "./Errors.ts";
import { ADOPT_MARKER_FILENAME } from "./Versions.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** Directory names never descended into during discovery (§3B.1). */
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", ".skillmaker"]);

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

const slugify = (name: string): string => {
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

/** `deprecated/` -> archived, `in-progress/` -> idea (with a note) (§3B.4). Checked over every path segment, not just the immediate parent. */
const lifecycleFromPath = (relativePath: string): { readonly lifecycle: SkillLifecycle; readonly note?: string } => {
  const segments = pathSegments(relativePath).map((segment) => segment.toLowerCase());
  if (segments.includes("deprecated")) {
    return { lifecycle: "archived", note: "adopted from a \"deprecated/\" directory" };
  }
  if (segments.includes("in-progress")) {
    return { lifecycle: "idea", note: "adopted from an \"in-progress/\" directory — likely unfinished" };
  }
  return { lifecycle: "idea" };
};

interface ManifestDetection {
  readonly relativePath: string;
  readonly kind: string;
}

interface EvalInfraDetection {
  readonly relativePath: string;
  readonly kind: "evals" | "tests";
}

/** One filesystem walk gathers everything discovery needs: SKILL.md files, existing bundle.json slugs (for collision avoidance), manifest files, `.agents/skills` dirs, and eval/test infra dirs. */
interface WalkResult {
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

const walk = Effect.fn("Adopt.walk")(function* (root: string) {
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

export interface AdoptReport {
  readonly found: number;
  readonly adopted: ReadonlyArray<AdoptedSkill>;
  readonly skipped: ReadonlyArray<SkippedSkill>;
  readonly warnings: ReadonlyArray<string>;
  readonly manifests: ReadonlyArray<ManifestDetection>;
  readonly evalInfra: ReadonlyArray<EvalInfraDetection>;
}

/**
 * Discovers and wraps every not-yet-adopted `SKILL.md` under `root` as an
 * in-place bundle (§3B.1-§3B.6, §3B.8). Filesystem-only: does not touch the
 * journal — callers (the CLI command) fold `AdoptedSkill`s into
 * `bundle.created` / `bundle.archived` / `skill.version_recorded` events,
 * mirroring how `New.ts` layers journal writes on top of
 * `Workspace.createBundle`.
 */
export const adoptWorkspace = Effect.fn("Adopt.adoptWorkspace")(function* (root: string) {
  const fs = yield* FileSystem;

  const { skillMdFiles, existingSlugs, manifests, evalInfra, warnings: walkWarnings } = yield* walk(root);

  const adopted: AdoptedSkill[] = [];
  const skipped: SkippedSkill[] = [];
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
    const { data: frontmatter, warnings: frontmatterWarnings } = parseFrontmatter(content);
    const generated = GENERATED_MARKER_PATTERN.test(content);

    const { lifecycle, note } = lifecycleFromPath(relativePath);

    const skillWarnings: string[] = [...frontmatterWarnings];
    if (generated) {
      skillWarnings.push(
        "SKILL.md appears to be generated output (an \"AUTO-GENERATED\" marker was found) — imported as-is, flagged rather than treated as hand-authored source",
      );
    }
    if (note !== undefined) {
      skillWarnings.push(note);
    }

    const baseSlug = slugify(basename(dir));
    const slug = uniqueSlug(baseSlug, usedSlugs);
    usedSlugs.add(slug);

    const identity = BundleIdentity.make({
      schemaVersion: 1,
      slug,
      name: stringField(frontmatter, "name") ?? titleCaseFromSlug(slug),
      oneLiner: stringField(frontmatter, "description") ?? "",
      tags: [],
      created: todayIsoDate(),
      targets: ["claude-code"],
    });

    yield* fs
      .writeFileString(bundleJsonPath, `${JSON.stringify(identity, null, 2)}\n`)
      .pipe(Effect.mapError(toIOError(`could not write ${bundleJsonPath}`)));

    const marker = AdoptMarker.make({
      schemaVersion: 1,
      adoptedAt: new Date().toISOString(),
      layout: "in-place",
      skillPath: "SKILL.md",
      generated,
      frontmatter,
    });
    yield* fs
      .writeFileString(join(dir, ADOPT_MARKER_FILENAME), `${JSON.stringify(marker, null, 2)}\n`)
      .pipe(Effect.mapError(toIOError(`could not write ${ADOPT_MARKER_FILENAME} in ${dir}`)));

    adopted.push({ slug, dir, relativePath, lifecycle, generated, warnings: skillWarnings });
  }

  return {
    found: skillMdFiles.length,
    adopted,
    skipped,
    warnings,
    manifests,
    evalInfra,
  } satisfies AdoptReport;
});

export { ADOPT_EXCLUDED_NAMES, ADOPT_MARKER_FILENAME } from "./Versions.ts";
