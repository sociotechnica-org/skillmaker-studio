/**
 * The install door (director rulings 2026-08-03, from the from-scratch E2E
 * walk -- docs/friction/e2e-readiness.md "Publish step has no UI"): publish
 * a Studio-born bundle's output to an INSTALL TARGET an agent actually
 * reads. Exactly TWO audiences, no picker beyond them:
 *
 *   - `"user"`    -> `~/.claude/skills/<slug>/` -- "All my agents". The
 *                    user-level claude home follows the `claude` CLI's own
 *                    convention (`ProviderProfile.ts`): `$CLAUDE_CONFIG_DIR`
 *                    when set, else `~/.claude`, with skills under
 *                    `skills/` (the user-level twin of the repo-local
 *                    `.claude/skills` in `Harness.ts`).
 *   - `"project"` -> `<workspace-root>/.claude/skills/<slug>/` -- "This
 *                    project's agents" (the project the bundle lives in).
 *                    Cross-project publishing: NOT built.
 *
 * The chosen audience is REMEMBERED per-bundle in `bundle.json`'s
 * `publishTargets` field (`Bundle.ts`) -- symbolic words, resolved locally
 * on whatever machine the bundle lands on. Re-publish updates the
 * remembered target(s); revert (`--version <hash>`) writes a previously
 * recorded version's snapshot content (`<bundle>/.skillmaker/versions/
 * <hash>/`, #169) to the same target(s).
 *
 * Every publish/revert is stamped honestly: a `skill.published` journal
 * event carrying version hash + target + the evidence state at that
 * version, AND a provenance comment in the installed `SKILL.md`. The
 * comment sits at the top of the file BUT below YAML frontmatter when the
 * file has it -- a deliberate deviation from the ruling's literal "top of
 * SKILL.md": harness skill loaders (Claude Code included) require the
 * `---` frontmatter block to open the file, and a comment above it would
 * break the very installation this door exists to perform.
 *
 * D4c preserved for ADOPTED in-place bundles: their live directory IS the
 * install location, so publish keeps writing there (`"in-place"` target;
 * the two-audience choice is only for bundles whose output has no live
 * home yet). In-place copies get NO provenance stamp -- their SKILL.md is
 * simultaneously the bundle's own recorded content, and stamping it would
 * register as output drift against the very version just published
 * (`Versions.computeDrift`), corrupting the drift hint. Flagged as a
 * deliberate deviation, not an oversight.
 *
 * One core function (`publishToInstallTargets`), three doors: the CLI's
 * `skillmaker publish --to`, the server's `POST /api/bundles/:slug/publish`,
 * and the viewer's Publish tab (which calls the server).
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join as joinPath } from "node:path";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { Actor } from "./Actor.ts";
import {
  InstallSnapshotMissingError,
  InstallTargetError,
  InstallVersionNotFoundError,
  PublishGuardError,
  WorkspaceIOError,
} from "./Errors.ts";
import { foldBundleStates } from "./Fold.ts";
import { HARNESS_SKILL_INSTALL_DIR } from "./Harness.ts";
import { layer as IndexServiceLayer, IndexService } from "./IndexService.ts";
import { Journal } from "./JournalService.ts";
import { CLAUDE_CODE_CONFIG_DIR_ENV_VAR } from "./ProviderProfile.ts";
import { checkPublishable } from "./Publish.ts";
import { SKILL_JSON_FILENAME } from "./SkillJson.ts";
import {
  ADOPT_EXCLUDED_NAMES,
  collectOutputFiles,
  detectBundleLayout,
  foldSkillVersions,
  hashOutputTree,
  resolveSkillVersion,
  shortHash,
  versionSnapshotDir,
  type BundleLayout,
  type SkillVersion,
} from "./Versions.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

// ---------------------------------------------------------------------------
// Audiences + target resolution
// ---------------------------------------------------------------------------

export const INSTALL_AUDIENCES = ["user", "project"] as const;
export type InstallAudience = (typeof INSTALL_AUDIENCES)[number];

export const isInstallAudience = (value: unknown): value is InstallAudience =>
  value === "user" || value === "project";

/** An install publish's destination word: one of the two audiences, or the D4c passthrough for adopted in-place bundles. */
export type InstallTargetKind = InstallAudience | "in-place";

/**
 * Machine-local facts target resolution needs -- injectable so tests and
 * the e2e suite's temp-HOME runs never touch the operator's real
 * `~/.claude`. Defaults read the live process environment.
 */
export interface InstallEnvironment {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}

export const liveInstallEnvironment = (): InstallEnvironment => ({
  env: process.env,
  homeDir: homedir(),
});

/** The repo-local claude-code skills subdirectory (`Harness.ts` / `ProviderProfile.ts`): `.claude/skills`. */
const CLAUDE_SKILLS_SUBDIR = HARNESS_SKILL_INSTALL_DIR["claude-code"];

/**
 * Resolves an audience to the absolute directory the skill installs into.
 * `"user"` follows the `claude` CLI's own config-dir convention
 * (`$CLAUDE_CONFIG_DIR` else `~/.claude`, `ProviderProfile.ts` fix F6);
 * `"project"` is the workspace's own repo-local `.claude/skills`.
 */
export const resolveInstallDir = (
  audience: InstallAudience,
  workspaceRoot: string,
  slug: string,
  environment: InstallEnvironment = liveInstallEnvironment(),
): string => {
  if (audience === "user") {
    const configDir = environment.env[CLAUDE_CODE_CONFIG_DIR_ENV_VAR] ?? joinPath(environment.homeDir, ".claude");
    return joinPath(configDir, "skills", slug);
  }
  return joinPath(workspaceRoot, ...CLAUDE_SKILLS_SUBDIR.split("/"), slug);
};

// ---------------------------------------------------------------------------
// Provenance stamp
// ---------------------------------------------------------------------------

/** The marker every stamp carries -- what `stripPublishStamp` (and thus installed-drift hashing) keys on. */
export const PUBLISH_STAMP_MARKER = "published by skillmaker-studio";

export interface PublishStampInput {
  readonly bundle: string;
  readonly versionHash: string;
  readonly versionLabel?: string;
  /** ISO date (YYYY-MM-DD). */
  readonly date: string;
  readonly evidence: string;
}

/** The provenance comment (director rulings 2026-08-03): who published, which bundle, which version, when, and the honest evidence line. */
export const renderPublishStamp = (input: PublishStampInput): string => {
  const version = `${shortHash(input.versionHash)}${input.versionLabel !== undefined ? ` (${input.versionLabel})` : ""}`;
  return [
    `<!-- ${PUBLISH_STAMP_MARKER}`,
    `bundle: ${input.bundle}`,
    `version: ${version}`,
    `date: ${input.date}`,
    `evidence: ${input.evidence} -->`,
  ].join("\n");
};

const STAMP_PATTERN = new RegExp(`<!-- ${PUBLISH_STAMP_MARKER}[\\s\\S]*?-->\\n?\\n?`);

/** Removes the first provenance stamp (and its trailing blank line) from a SKILL.md body -- the installed-drift hash and re-stamping both go through here. */
export const stripPublishStamp = (content: string): string => content.replace(STAMP_PATTERN, "");

/**
 * Inserts (or replaces) the stamp at the top of a SKILL.md body -- below
 * the closing `---` of YAML frontmatter when the file opens with one, else
 * at the very top (see the module header for why frontmatter must stay
 * first).
 */
export const applyPublishStamp = (content: string, stamp: string): string => {
  const stripped = stripPublishStamp(content);
  if (stripped.startsWith("---\n")) {
    const close = stripped.indexOf("\n---", 3);
    if (close !== -1) {
      const afterClose = stripped.indexOf("\n", close + 1 + 3);
      const headEnd = afterClose === -1 ? stripped.length : afterClose + 1;
      const head = stripped.slice(0, headEnd);
      const rest = stripped.slice(headEnd).replace(/^\n*/, "");
      return `${head}\n${stamp}\n\n${rest}`;
    }
  }
  return `${stamp}\n\n${stripped.replace(/^\n*/, "")}`;
};

// ---------------------------------------------------------------------------
// Evidence line
// ---------------------------------------------------------------------------

/**
 * "<measured> of <total> claims measured" -- the SAME claim/fixture/
 * measurement join the viewer's Evals tree uses (evals.ts
 * `claimFixtureCases`, IA §C rule 2): a claim's fixtures are the cases
 * whose `case.json.risks` name it, plus the risk-map's authored
 * `fixtureCase` column as a fallback while the dual-write exists; a claim
 * is MEASURED at a version when any of its fixtures has a measurement cell
 * (n > 0) at that version. Derived, never restated by hand.
 */
export const measuredClaimsEvidence = (
  claims: ReadonlyArray<{ readonly riskId: string; readonly fixtureCase?: string }>,
  fixtures: ReadonlyArray<{ readonly caseName: string; readonly risks: ReadonlyArray<string> }>,
  measurements: ReadonlyArray<{ readonly fixtureCase: string; readonly versionHash: string; readonly n: number }>,
  versionHash: string,
): string => {
  const measuredCases = new Set(
    measurements.filter((m) => m.versionHash === versionHash && m.n > 0).map((m) => m.fixtureCase),
  );
  const measured = claims.filter((claim) => {
    const cases = fixtures.filter((f) => f.risks.includes(claim.riskId)).map((f) => f.caseName);
    if (claim.fixtureCase !== undefined && !cases.includes(claim.fixtureCase)) {
      cases.push(claim.fixtureCase);
    }
    return cases.some((c) => measuredCases.has(c));
  }).length;
  return `${measured} of ${claims.length} claims measured`;
};

/** The honest fallback when the workspace index can't be read at publish time -- never fabricate a zero count. */
export const EVIDENCE_UNAVAILABLE = "evidence unavailable";

/** Best-effort evidence gather via a scratch `IndexService` (same pattern as `Publish.gatherMeasurements`); an index problem yields the honest `EVIDENCE_UNAVAILABLE`, never a fake "0 of 0". */
const gatherEvidence = (workspaceRoot: string, bundle: string, versionHash: string) =>
  Effect.gen(function* () {
    const index = yield* IndexService;
    yield* index.rebuild();
    const claims = yield* index.listRiskCoverage(bundle);
    const fixtures = yield* index.listFixtures(bundle);
    const measurements = yield* index.listMeasurements(bundle);
    return measuredClaimsEvidence(claims, fixtures, measurements, versionHash);
  }).pipe(
    Effect.provide(IndexServiceLayer(workspaceRoot)),
    Effect.orElseSucceed(() => EVIDENCE_UNAVAILABLE),
  );

// ---------------------------------------------------------------------------
// Remembered targets (bundle.json `publishTargets`)
// ---------------------------------------------------------------------------

/**
 * Reads the remembered install audiences -- from `skill.json`'s
 * `publish.targets` on a migrated bundle (THE MERGE: it absorbed
 * bundle.json's `publishTargets` verbatim), else from
 * `<bundleDir>/bundle.json`. Tolerant: a missing/malformed file or field
 * reads as "nothing remembered".
 */
export const readRememberedInstallTargets = Effect.fn("InstallPublish.readRememberedInstallTargets")(
  function* (bundleDir: string) {
    const fs = yield* FileSystem;
    const path = yield* Path;
    const skillJsonPath = path.join(bundleDir, SKILL_JSON_FILENAME);
    const skillJsonExists = yield* fs.exists(skillJsonPath).pipe(Effect.orElseSucceed(() => false));
    if (skillJsonExists) {
      const raw = yield* fs.readFileString(skillJsonPath).pipe(Effect.orElseSucceed(() => ""));
      try {
        const parsed = JSON.parse(raw) as { readonly publish?: { readonly targets?: unknown } };
        const field = parsed.publish?.targets;
        return Array.isArray(field)
          ? field.filter(isInstallAudience)
          : ([] as ReadonlyArray<InstallAudience>);
      } catch {
        return [] as ReadonlyArray<InstallAudience>;
      }
    }
    const bundleJsonPath = path.join(bundleDir, "bundle.json");
    const exists = yield* fs
      .exists(bundleJsonPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!exists) return [] as ReadonlyArray<InstallAudience>;
    const raw = yield* fs.readFileString(bundleJsonPath).pipe(Effect.orElseSucceed(() => ""));
    try {
      const parsed = JSON.parse(raw) as { readonly publishTargets?: unknown };
      const field = parsed.publishTargets;
      if (!Array.isArray(field)) return [] as ReadonlyArray<InstallAudience>;
      return field.filter(isInstallAudience);
    } catch {
      return [] as ReadonlyArray<InstallAudience>;
    }
  },
);

/**
 * Merges `audiences` into `bundle.json`'s `publishTargets` (union, existing
 * order preserved) via a LOSSLESS raw-JSON merge -- every other field on
 * disk, known to `BundleIdentity` or not, survives verbatim (the "adopt"
 * principle `Publish.ts`'s manifest writers follow). Best-effort: a bundle
 * without a parseable bundle.json (journal-only bundles) just doesn't get
 * a memory -- remembering is a convenience and must never fail a publish
 * whose files already landed.
 */
export const rememberInstallTargets = Effect.fn("InstallPublish.rememberInstallTargets")(function* (
  bundleDir: string,
  audiences: ReadonlyArray<InstallAudience>,
) {
  const fs = yield* FileSystem;
  const path = yield* Path;

  // THE MERGE: a migrated bundle remembers audiences in `skill.json`'s
  // `publish.targets` (same lossless raw-JSON merge -- every other field,
  // known or not, survives verbatim). Legacy bundles keep bundle.json.
  const skillJsonPath = path.join(bundleDir, SKILL_JSON_FILENAME);
  const skillJsonRaw = yield* fs.readFileString(skillJsonPath).pipe(Effect.orElseSucceed(() => undefined));
  if (skillJsonRaw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(skillJsonRaw);
    } catch {
      return false;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    const publishRaw = record["publish"];
    const publish: Record<string, unknown> =
      typeof publishRaw === "object" && publishRaw !== null && !Array.isArray(publishRaw)
        ? (publishRaw as Record<string, unknown>)
        : {};
    const existingRaw = publish["targets"];
    const existingVerbatim: ReadonlyArray<unknown> = Array.isArray(existingRaw) ? existingRaw : [];
    const existing = existingVerbatim.filter(isInstallAudience);
    const toAdd = audiences.filter((a) => !existing.includes(a));
    if (toAdd.length === 0) {
      return false;
    }
    publish["targets"] = [...existingVerbatim, ...toAdd];
    record["publish"] = publish;
    yield* fs
      .writeFileString(skillJsonPath, `${JSON.stringify(record, undefined, 2)}\n`)
      .pipe(Effect.mapError(toIOError(`could not write ${skillJsonPath}`)));
    return true;
  }

  const bundleJsonPath = path.join(bundleDir, "bundle.json");
  const raw = yield* fs.readFileString(bundleJsonPath).pipe(Effect.orElseSucceed(() => undefined));
  if (raw === undefined) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  const existingRaw = record["publishTargets"];
  const existing = Array.isArray(existingRaw) ? existingRaw.filter(isInstallAudience) : [];
  const merged = [...existing, ...audiences.filter((a) => !existing.includes(a))];
  if (merged.length === existing.length && merged.every((a, i) => existing[i] === a)) {
    return false;
  }
  record["publishTargets"] = merged;
  yield* fs
    .writeFileString(bundleJsonPath, `${JSON.stringify(record, undefined, 2)}\n`)
    .pipe(Effect.mapError(toIOError(`could not write ${bundleJsonPath}`)));
  return true;
});

// ---------------------------------------------------------------------------
// Installed drift
// ---------------------------------------------------------------------------

/** How an installed copy stands against the last-published version: absent, faithful, or hand-edited since publish. */
export type InstalledDrift = "not-installed" | "in-sync" | "installed-edited";

/**
 * Drift against the INSTALLED copy (director rulings 2026-08-03) -- the
 * Studio-born twin of the D4c fact that an adopted bundle's live tree IS
 * its installed copy. Hashes the installed directory with the provenance
 * stamp stripped out of `SKILL.md` (the stamp is publish metadata, not
 * skill content) and compares against the published version's recorded
 * output hash. Same hashing algorithm as `Versions.hashOutputTree`, by
 * construction -- this IS that function, with a content transform.
 */
export const computeInstalledDrift = Effect.fn("InstallPublish.computeInstalledDrift")(function* (
  installedDir: string,
  publishedOutputHash: string,
) {
  const fs = yield* FileSystem;
  const exists = yield* fs
    .exists(installedDir)
    .pipe(Effect.mapError(toIOError(`could not check ${installedDir}`)));
  if (!exists) return "not-installed" as InstalledDrift;
  const hash = yield* hashOutputTree(installedDir, {
    transformContent: (relativePath, content) =>
      relativePath === "SKILL.md" ? stripPublishStamp(content) : content,
  });
  return (hash === publishedOutputHash ? "in-sync" : "installed-edited") as InstalledDrift;
});

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

export interface InstallPublishInput {
  readonly workspaceRoot: string;
  /** The bundle's ACTUAL directory (in-place bundles do not live at `<skillsDir>/<slug>`). */
  readonly bundleDir: string;
  readonly bundle: string;
  readonly actor: Actor;
  /** Explicit audience (`--to`); `undefined` publishes to the remembered target(s). */
  readonly to?: InstallAudience;
  /** Version hash prefix (`--version`) -- a revert-shaped publish from the snapshot store. `undefined` publishes the latest recorded version (full guard applies). */
  readonly version?: string;
  /** Machine-local resolution facts; tests inject a temp HOME here. */
  readonly environment?: InstallEnvironment;
}

export interface InstallTargetResult {
  readonly target: InstallTargetKind;
  /** The installed skill directory. */
  readonly path: string;
  /** `"already_published"` = this exact content was already installed AND journaled -- a true no-op. */
  readonly status: "published" | "already_published";
}

export interface InstallPublishResult {
  readonly bundle: string;
  readonly versionHash: string;
  readonly versionLabel?: string;
  readonly evidence: string;
  /** `false` for the in-place passthrough (see module header). */
  readonly stamped: boolean;
  readonly results: ReadonlyArray<InstallTargetResult>;
  /** The remembered audiences AFTER this publish. Empty for in-place bundles (their memory is the layout itself). */
  readonly remembered: ReadonlyArray<InstallAudience>;
}

/** One file to install: relative path within the skill dir + exact content. */
interface InstallFile {
  readonly relativePath: string;
  readonly content: Uint8Array | string;
}

/** Collects the selected version's payload from its snapshot (`<bundle>/.skillmaker/versions/<hash>/`), or -- when the snapshot predates #169 and the selected version is the in-sync latest -- from the live payload. */
const collectSourceFiles = Effect.fn("InstallPublish.collectSourceFiles")(function* (
  bundle: string,
  bundleDir: string,
  layout: BundleLayout,
  version: SkillVersion,
  allowLiveFallback: boolean,
) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const snapshotDir = versionSnapshotDir(bundleDir, version.hash);
  const snapshotExists = yield* fs
    .exists(snapshotDir)
    .pipe(Effect.mapError(toIOError(`could not check ${snapshotDir}`)));

  if (snapshotExists) {
    // Snapshot layout (Versions.snapshotVersionContent): design.md at the
    // root (studio annotation, never installed), payload under `output/`
    // for an output-dir bundle or at its own relative paths for in-place.
    const files = yield* collectOutputFiles(snapshotDir);
    const payload: InstallFile[] = [];
    for (const file of files) {
      if (layout === "output-dir") {
        if (!file.relativePath.startsWith("output/")) continue;
        const content = yield* fs
          .readFile(file.fullPath)
          .pipe(Effect.mapError(toIOError(`could not read ${file.fullPath}`)));
        payload.push({ relativePath: file.relativePath.slice("output/".length), content });
      } else {
        if (file.relativePath === "design.md") continue;
        const content = yield* fs
          .readFile(file.fullPath)
          .pipe(Effect.mapError(toIOError(`could not read ${file.fullPath}`)));
        payload.push({ relativePath: file.relativePath, content });
      }
    }
    return payload;
  }

  if (!allowLiveFallback) {
    return yield* Effect.fail(
      InstallSnapshotMissingError.make({ bundle, versionHash: version.hash }),
    );
  }

  // Live payload -- only reachable when the guard already proved the live
  // tree in-sync with this (latest) version, so content is identical.
  const payloadRoot = layout === "in-place" ? bundleDir : path.join(bundleDir, "output");
  const files = yield* collectOutputFiles(
    payloadRoot,
    layout === "in-place" ? { excludeTopLevel: ADOPT_EXCLUDED_NAMES } : undefined,
  );
  const payload: InstallFile[] = [];
  for (const file of files) {
    const content = yield* fs
      .readFile(file.fullPath)
      .pipe(Effect.mapError(toIOError(`could not read ${file.fullPath}`)));
    payload.push({ relativePath: file.relativePath, content });
  }
  return payload;
});

/** Deterministic 12-hex signature over the exact bytes an install write would land -- the idempotency component that lets a revert to an older version journal as a REAL act while a same-content re-publish stays a no-op. */
const installContentSignature = (files: ReadonlyArray<InstallFile>): string => {
  const pairs = [...files]
    .sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1))
    .map((file) => [file.relativePath, sha256Hex(file.content)] as const);
  return sha256Hex(JSON.stringify(pairs)).slice(0, 12);
};

/**
 * Would writing `files` into `destDir` change anything on disk? For a
 * clearing install (`checkExtras`) a stale extra file also counts as a
 * change; the in-place passthrough compares payload files only (the bundle
 * dir legitimately holds studio files beside them). This is what decides
 * whether a publish is a REAL act to journal: a revert that re-lands
 * previously-published bytes changes the tree and must be recorded, while
 * a same-content re-publish is a true no-op (the incident class from
 * proposal 2026-07-20 appendix #3, applied to installs).
 */
const installWouldChange = Effect.fn("InstallPublish.installWouldChange")(function* (
  destDir: string,
  files: ReadonlyArray<InstallFile>,
  checkExtras: boolean,
) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  const exists = yield* fs.exists(destDir).pipe(Effect.mapError(toIOError(`could not check ${destDir}`)));
  if (!exists) return true;
  if (checkExtras) {
    const existing = yield* collectOutputFiles(destDir);
    const wanted = new Set(files.map((file) => file.relativePath));
    if (existing.length !== wanted.size || existing.some((file) => !wanted.has(file.relativePath))) {
      return true;
    }
  }
  for (const file of files) {
    const destination = path.join(destDir, ...file.relativePath.split("/"));
    const present = yield* fs
      .exists(destination)
      .pipe(Effect.mapError(toIOError(`could not check ${destination}`)));
    if (!present) return true;
    const current = yield* fs
      .readFile(destination)
      .pipe(Effect.mapError(toIOError(`could not read ${destination}`)));
    const desired =
      typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
    if (current.length !== desired.length || sha256Hex(current) !== sha256Hex(desired)) {
      return true;
    }
  }
  return false;
});

/** Writes the file set into `destDir`. Output-dir installs clear the destination first (a version change must not leave a stale sibling behind); the in-place passthrough only ever overwrites its own payload files -- the bundle dir also holds studio files that must survive. */
const writeInstallFiles = Effect.fn("InstallPublish.writeInstallFiles")(function* (
  destDir: string,
  files: ReadonlyArray<InstallFile>,
  clearFirst: boolean,
) {
  const fs = yield* FileSystem;
  const path = yield* Path;
  if (clearFirst) {
    yield* fs
      .remove(destDir, { recursive: true, force: true })
      .pipe(Effect.mapError(toIOError(`could not clear ${destDir}`)));
  }
  for (const file of files) {
    const destination = path.join(destDir, ...file.relativePath.split("/"));
    yield* fs
      .makeDirectory(path.dirname(destination), { recursive: true })
      .pipe(Effect.mapError(toIOError(`could not create ${path.dirname(destination)}`)));
    if (typeof file.content === "string") {
      yield* fs
        .writeFileString(destination, file.content)
        .pipe(Effect.mapError(toIOError(`could not write ${destination}`)));
    } else {
      yield* fs
        .writeFile(destination, file.content)
        .pipe(Effect.mapError(toIOError(`could not write ${destination}`)));
    }
  }
});

/**
 * The one install-publish entry point (CLI `publish --to`, server
 * `POST /api/bundles/:slug/publish`, viewer Publish tab). See the module
 * header for the full contract. Guard behavior:
 *
 * - plain publish (no `version`): the full `checkPublishable` guard --
 *   stage `"published"`, latest version recorded, live content in-sync.
 * - revert-shaped (`version` given): stage must still be `"published"` and
 *   the version's SNAPSHOT must exist; the live-drift check is deliberately
 *   skipped -- content comes from the snapshot store, so live edits are
 *   irrelevant to what gets written.
 */
export const publishToInstallTargets = Effect.fn("InstallPublish.publishToInstallTargets")(function* (
  input: InstallPublishInput,
) {
  const journal = yield* Journal;
  const events = yield* journal.readAll();
  const layout = yield* detectBundleLayout(input.bundleDir);
  const versions = foldSkillVersions(events).get(input.bundle) ?? [];

  // -- select the version --------------------------------------------------
  let selected: SkillVersion;
  let allowLiveFallback: boolean;
  if (input.version === undefined) {
    yield* checkPublishable(input.bundleDir, input.bundle, events);
    // checkPublishable guarantees a latest version exists and is in-sync.
    selected = versions.at(-1) as SkillVersion;
    allowLiveFallback = true;
  } else {
    const stage = foldBundleStates(events).get(input.bundle)?.stage ?? "idea";
    if (stage !== "published") {
      return yield* Effect.fail(
        PublishGuardError.make({
          bundle: input.bundle,
          reason: `bundle "${input.bundle}" is at stage "${stage}", not "published" -- publish requires the bundle to have completed the publish gate`,
        }),
      );
    }
    const resolved = resolveSkillVersion(versions, input.version);
    if (resolved === undefined) {
      return yield* Effect.fail(
        InstallVersionNotFoundError.make({ bundle: input.bundle, version: input.version }),
      );
    }
    selected = resolved;
    allowLiveFallback = false;
  }

  // -- resolve targets -----------------------------------------------------
  const environment = input.environment ?? liveInstallEnvironment();
  const rememberedBefore = yield* readRememberedInstallTargets(input.bundleDir);

  let targets: ReadonlyArray<{ readonly kind: InstallTargetKind; readonly dir: string }>;
  if (layout === "in-place") {
    if (input.to !== undefined) {
      return yield* Effect.fail(
        InstallTargetError.make({
          bundle: input.bundle,
          reason: `bundle "${input.bundle}" was adopted in place -- its live directory IS the install location, so "--to" does not apply (D4c)`,
        }),
      );
    }
    targets = [{ kind: "in-place", dir: input.bundleDir }];
  } else {
    const audiences = input.to !== undefined ? [input.to] : rememberedBefore;
    if (audiences.length === 0) {
      return yield* Effect.fail(
        InstallTargetError.make({
          bundle: input.bundle,
          reason: `no install target chosen yet for "${input.bundle}" -- pass --to user (all my agents, ~/.claude/skills) or --to project (this project's agents, .claude/skills); the choice is remembered`,
        }),
      );
    }
    targets = audiences.map((audience) => ({
      kind: audience,
      dir: resolveInstallDir(audience, input.workspaceRoot, input.bundle, environment),
    }));
  }

  // -- assemble content ----------------------------------------------------
  const evidence = yield* gatherEvidence(input.workspaceRoot, input.bundle, selected.hash);
  const sourceFiles = yield* collectSourceFiles(input.bundle, input.bundleDir, layout, selected, allowLiveFallback);
  const stamped = layout !== "in-place";
  const stamp = renderPublishStamp({
    bundle: input.bundle,
    versionHash: selected.hash,
    ...(selected.label !== undefined ? { versionLabel: selected.label } : {}),
    date: new Date().toISOString().slice(0, 10),
    evidence,
  });
  const installFiles: ReadonlyArray<InstallFile> = stamped
    ? sourceFiles.map((file) =>
        file.relativePath === "SKILL.md"
          ? {
              relativePath: file.relativePath,
              content: applyPublishStamp(
                typeof file.content === "string" ? file.content : new TextDecoder().decode(file.content),
                stamp,
              ),
            }
          : file,
      )
    : sourceFiles;
  const signature = installContentSignature(installFiles);

  // -- write + journal per target ------------------------------------------
  // Journal on REAL acts (the marketplace targets' contract, proposal
  // 2026-07-20 appendix #3): a write that changes the installed tree is
  // recorded even when this exact content was published here before (the
  // revert case -- something else held the target in between); a
  // same-content re-publish writes nothing and journals nothing. The
  // `:re-<n>` suffix keeps repeated real re-lands of the same content
  // distinct without ever double-journaling one act.
  const results: InstallTargetResult[] = [];
  const appendedKeys: string[] = [];
  for (const target of targets) {
    const baseKey = `skill.published:${input.bundle}:${selected.hash}:${target.kind}:${signature}`;
    const changed = yield* installWouldChange(target.dir, installFiles, target.kind !== "in-place");
    const priorCount =
      events.filter((event) => event.idempotencyKey?.startsWith(baseKey) === true).length +
      appendedKeys.filter((key) => key.startsWith(baseKey)).length;

    if (!changed && priorCount > 0) {
      results.push({ target: target.kind, path: target.dir, status: "already_published" });
      continue;
    }

    if (changed) {
      yield* writeInstallFiles(target.dir, installFiles, target.kind !== "in-place");
    }
    const idempotencyKey = priorCount === 0 ? baseKey : `${baseKey}:re-${priorCount}`;
    const appendResult = yield* journal.append({
      type: "skill.published",
      actor: input.actor,
      idempotencyKey,
      payload: {
        bundle: input.bundle,
        versionHash: selected.hash,
        target: target.kind,
        url: target.dir,
        evidence,
      },
    });
    appendedKeys.push(idempotencyKey);
    results.push({
      target: target.kind,
      path: target.dir,
      status: appendResult.status === "appended" ? "published" : "already_published",
    });
  }

  // -- remember ------------------------------------------------------------
  let remembered: ReadonlyArray<InstallAudience> = rememberedBefore;
  if (layout !== "in-place") {
    const publishedAudiences = targets
      .map((target) => target.kind)
      .filter(isInstallAudience);
    yield* rememberInstallTargets(input.bundleDir, publishedAudiences);
    remembered = [
      ...rememberedBefore,
      ...publishedAudiences.filter((a) => !rememberedBefore.includes(a)),
    ];
  }

  const result: InstallPublishResult = {
    bundle: input.bundle,
    versionHash: selected.hash,
    ...(selected.label !== undefined ? { versionLabel: selected.label } : {}),
    evidence,
    stamped,
    results,
    remembered,
  };
  return result;
});
