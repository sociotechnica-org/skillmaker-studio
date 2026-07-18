/**
 * The triage manifest (issue #92, `Mechanism - Receiving Dock.md` §HOW:
 * "Bulk import is the same tree as a triage manifest"): `adopt --triage`
 * runs the existing discovery sweep (`Adopt.ts`'s `walk`) but acts on
 * nothing -- it writes `adopt-manifest.md`, a markdown table the maker
 * edits by hand, non-agentically. `adopt --from-manifest` reads that table
 * back and executes each row as an individual act.
 *
 * Order is load-bearing, mirrored from the dock's own single-crate
 * elicitation tree (§HOW, "the cheap, pruning question comes first"):
 * decision (keep/archive/skip) before whose, whose before rights, stakes
 * before hurts -- the manifest's column order is the same tree, laid flat.
 *
 * Issue #108 ("triage fills the card; the system grades the entry")
 * reshaped the tail of that tree: the maturity self-grade column is retired
 * (entry stage is now DERIVED from the directory's observable condition,
 * `deriveEntryStage` below -- never asked), and the manifest becomes the
 * card's batch form: `Job`/`Out-of-scope`/`Basis` are free-text card fields
 * whose answers land in the freshly adopted skill's dossier.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { basename, dirname, join, relative, sep } from "node:path";
import type { Actor } from "./Actor.ts";
import { type BundleStage } from "./Bundle.ts";
import {
  ADOPT_MARKER_FILENAME,
  adoptDirectoryInPlace,
  lifecycleFromPath,
  parseFrontmatter,
  walk,
  type EvalInfraDetection,
  type Frontmatter,
  type ManifestDetection,
} from "./Adopt.ts";
import type { DossierSectionName, DossierSeed } from "./Dossier.ts";
import { DEFAULT_PRIORITY_BY_KIND } from "./FoldTodos.ts";
import { scanFixtures } from "./Fixtures.ts";
import { IntakeStakes, type IntakeRights } from "./Journal.ts";
import { Journal } from "./JournalService.ts";
import { cellByName, collectTableLines, knownColumnLookup, resolveColumns, splitTableCells } from "./MarkdownTable.ts";
import {
  classifyIntakeEvidence,
  gatherIntakeRegistry,
  receiveCrate,
  type IntakeEvidence,
  type IntakeRegistry,
  type IntakeVerdict,
} from "./Receive.ts";
import type { Todo } from "./Todo.ts";
import {
  ADOPT_EXCLUDED_NAMES,
  computeBundleHashes,
  hashOutputTree,
  recordSkillVersion,
} from "./Versions.ts";
import { layer as IndexServiceLayer } from "./IndexService.ts";
import { WorkspaceIOError } from "./Errors.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const TRIAGE_DECISIONS = ["keep", "archive", "skip"] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];
export const isTriageDecision = (value: string): value is TriageDecision =>
  (TRIAGE_DECISIONS as ReadonlyArray<string>).includes(value);

/**
 * `mine` is the only value that routes through `adopt` (§CLI). Every other
 * value -- `outside`/`came-back`/`unknown`, and `receive` itself, the
 * deliberate deferral default for evidence-bearing rows ("provable arrivals
 * are challenged, not silently stamped") -- routes through `skillmaker
 * receive` for that one directory. `receive` is not one of the dock's own
 * four elicitation answers (`Mechanism - Receiving Dock.md` §HOW lists
 * mine/outside/came-back/unknown); it exists only here, as shorthand for
 * "don't decide the sub-category, just dock it and let the dock's own
 * facts carry it."
 */
export const TRIAGE_WHOSE_VALUES = ["mine", "outside", "came-back", "unknown", "receive"] as const;
export type TriageWhose = (typeof TRIAGE_WHOSE_VALUES)[number];
export const isTriageWhose = (value: string): value is TriageWhose =>
  (TRIAGE_WHOSE_VALUES as ReadonlyArray<string>).includes(value);

/**
 * Derived from `Journal.ts`'s `IntakeStakes` schema (issue #108) -- ONE
 * source of truth for the stakes vocabulary in core, now that the manifest's
 * `Stakes` answer lands on `skill.received`'s own structured `stakes` field
 * rather than being flattened into `notes` prose.
 */
export const TRIAGE_STAKES_VALUES: ReadonlyArray<IntakeStakes> = IntakeStakes.literals;
export type TriageStakes = IntakeStakes;
export const isTriageStakes = (value: string): value is TriageStakes =>
  (TRIAGE_STAKES_VALUES as ReadonlyArray<string>).includes(value);

/**
 * The system's own placement of a brownfield import (issue #108, replacing
 * the retired maturity self-grade; data-model draft §Receive "Triage":
 * "Entry column is derived from what's observably there (no runnable output
 * → early columns; runnable output → Proof)"). A MACHINE DERIVATION from
 * observables, never testimony -- no human is asked anything:
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
export const deriveEntryStage = (condition: Pick<MechanicalCondition, "parses" | "complete">): BundleStage => {
  if (condition.parses && condition.complete) {
    return "evaluating";
  }
  if (condition.parses) {
    return "drafting";
  }
  return "idea";
};

/**
 * The reason recorded on the single `bundle.stage_changed` the adopt path
 * appends when `deriveEntryStage` lands past `"idea"` (issue #108). "Derived"
 * is load-bearing wording: this is the system's own read of observables, not
 * a human's claim. The event carries NO `override` field -- override marks a
 * human overriding the guard, and nothing of the kind happened here: this is
 * the system's own placement at birth, and the stage-move guard
 * (`Machine.ts`'s `checkTransition`) is enforced at the interactive write
 * paths (`advance`, the server's POST allowlist), not at triage's append.
 */
export const TRIAGE_ENTRY_STAGE_REASON = "triage: entry stage derived from runnable output";

// ---------------------------------------------------------------------------
// Mechanical condition (the OS&D clipboard -- automated, never human-edited)
// ---------------------------------------------------------------------------

export interface MechanicalCondition {
  /** A frontmatter block was found at all (`Adopt.ts`'s `parseFrontmatter`). */
  readonly parses: boolean;
  /** Judgment call: "bundle-complete" reads here as "has BOTH standard frontmatter fields a real identity needs" -- `name` and `description`, the same two fields `BundleIdentity.name`/`oneLiner` are sourced from at adopt time. */
  readonly complete: boolean;
  /** At least one `evals/fixtures/*\/case.json` scans cleanly (`Fixtures.ts`'s `scanFixtures`, tolerant). */
  readonly hasEvals: boolean;
}

const stringField = (data: Frontmatter, key: string): string | undefined => {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const NO_FRONTMATTER_MARKER = "no frontmatter block found";

const computeMechanicalCondition = Effect.fn("Triage.computeMechanicalCondition")(function* (
  dir: string,
  frontmatter: Frontmatter,
  frontmatterWarnings: ReadonlyArray<string>,
) {
  const parses = !frontmatterWarnings.some((warning) => warning.includes(NO_FRONTMATTER_MARKER));
  const complete = stringField(frontmatter, "name") !== undefined && stringField(frontmatter, "description") !== undefined;
  const fixtureScan = yield* scanFixtures(dir);
  const hasEvals = fixtureScan.cases.length > 0;
  return { parses, complete, hasEvals } satisfies MechanicalCondition;
});

const MECHANICAL_TOKENS: ReadonlyArray<
  readonly [keyof MechanicalCondition, /* true label */ string, /* false label */ string]
> = [
  ["parses", "parses", "does not parse"],
  ["complete", "complete", "incomplete"],
  ["hasEvals", "has evals", "no evals"],
];

const renderMechanicalCondition = (condition: MechanicalCondition): string =>
  MECHANICAL_TOKENS.map(([key, trueLabel, falseLabel]) => (condition[key] ? trueLabel : falseLabel)).join(", ");

/** Tolerant: an unrecognized/missing token defaults to the cautious (false) reading -- a machine column regenerated by `--triage` anyway, never load-bearing for `--from-manifest`'s own execution. */
const parseMechanicalCondition = (cell: string): MechanicalCondition => {
  const tokens = cell.split(",").map((token) => token.trim().toLowerCase());
  const result: { parses: boolean; complete: boolean; hasEvals: boolean } = {
    parses: false,
    complete: false,
    hasEvals: false,
  };
  for (const [key, trueLabel] of MECHANICAL_TOKENS) {
    result[key] = tokens.includes(trueLabel);
  }
  return result;
};

// ---------------------------------------------------------------------------
// Registry evidence rendering (`IntakeEvidence`, `Receive.ts`)
// ---------------------------------------------------------------------------

const renderEvidence = (evidence: IntakeEvidence): string => {
  switch (evidence.kind) {
    case "hash-match":
      return `hash matches recorded version ${evidence.bundle}`;
    case "name-collision":
      return `name collides with bundle ${evidence.bundle}`;
    case "foreign-marker":
      return "carries foreign adopt marker";
    case "bare":
      return "bare";
  }
};

const HASH_MATCH_PATTERN = /^hash matches recorded version (.+)$/;
const NAME_COLLISION_PATTERN = /^name collides with bundle (.+)$/;

/** Tolerant: an unrecognized cell defaults to `"bare"` -- the least alarming reading, never a fabricated collision (a machine column, not load-bearing for execution). */
const parseEvidence = (cell: string): IntakeEvidence => {
  const trimmed = cell.trim();
  const hashMatch = HASH_MATCH_PATTERN.exec(trimmed);
  if (hashMatch !== null && hashMatch[1] !== undefined) {
    return { kind: "hash-match", bundle: hashMatch[1].trim() };
  }
  const nameCollision = NAME_COLLISION_PATTERN.exec(trimmed);
  if (nameCollision !== null && nameCollision[1] !== undefined) {
    return { kind: "name-collision", bundle: nameCollision[1].trim() };
  }
  if (trimmed === "carries foreign adopt marker") {
    return { kind: "foreign-marker" };
  }
  return { kind: "bare" };
};

/** Deferral default per the ruling: an evidence-bearing row defaults `whose` to `"receive"` (dock it, don't decide); a bare row defaults to `"mine"` (adopt's own declared intent). */
export const defaultWhoseFor = (evidence: IntakeEvidence): TriageWhose =>
  evidence.kind === "bare" ? "mine" : "receive";

// ---------------------------------------------------------------------------
// The manifest row
// ---------------------------------------------------------------------------

/**
 * The card fields (`job`/`outOfScope`/`basis`, issue #108) are `DossierSeed`
 * ITSELF, not a hand-copied triple: the manifest's answers are exactly what
 * seeds the freshly adopted dossier (`executeManifestRow` passes the row
 * straight through as the seed), so the row IS a seed by type -- the two
 * shapes cannot drift apart. Blank = not asked = honest gap, per
 * `DossierSeed`'s own field docs.
 */
export interface TriageRow extends DossierSeed {
  readonly name: string;
  /** Relative to the workspace root, forward-slash always (portable, matches `IndexService.ts`'s own convention). */
  readonly path: string;
  readonly mechanicalCondition: MechanicalCondition;
  readonly evidence: IntakeEvidence;
  readonly decision: TriageDecision;
  readonly whose: TriageWhose;
  readonly rights?: IntakeRights;
  readonly stakes?: TriageStakes;
  readonly hurts?: string;
  readonly priority?: number;
}

export interface TriageSkippedRow {
  readonly path: string;
  readonly reason: "already-adopted";
}

export interface TriageWorkspaceResult {
  readonly rows: ReadonlyArray<TriageRow>;
  /** Directories `walk` found that already carry `bundle.json` -- already have identity, so no manifest row is needed (mirrors `adoptWorkspace`'s own "already-adopted" skip). */
  readonly skipped: ReadonlyArray<TriageSkippedRow>;
  readonly warnings: ReadonlyArray<string>;
  readonly manifests: ReadonlyArray<ManifestDetection>;
  readonly evalInfra: ReadonlyArray<EvalInfraDetection>;
}

const toPortablePath = (root: string, dir: string): string => relative(root, dir).split(sep).join("/");

/**
 * `adopt --triage`'s engine: runs the same read-only discovery sweep
 * `adoptWorkspace` uses (`Adopt.ts`'s `walk`), classifies each not-yet-
 * adopted candidate's mechanical condition and registry evidence, and
 * returns one `TriageRow` per candidate with every human column at its
 * deferral default. Acts on nothing -- no filesystem write, no journal
 * append (the manifest file itself is written by the CLI layer, same
 * split `adoptWorkspace`/the CLI's `runAdopt` already has).
 *
 * `workspaceRoot` and `sweepRoot` are deliberately separate parameters
 * (`sweepRoot` defaults to `workspaceRoot`): `--triage [path]` may sweep a
 * subdirectory, exactly like plain `adopt [path]` does, but the registry
 * (existing bundles + recorded hashes) and every row's `path` must stay
 * anchored to the WHOLE workspace -- otherwise a subtree sweep would miss
 * evidence recorded elsewhere in the corpus, and `--from-manifest` (which
 * only knows the workspace root) would resolve a row's path against the
 * wrong base and find nothing there.
 */
export const triageWorkspace = Effect.fn("Triage.triageWorkspace")(function* (
  workspaceRoot: string,
  sweepRoot: string = workspaceRoot,
) {
  const fs = yield* FileSystem;
  const { skillMdFiles, manifests, evalInfra, warnings: walkWarnings } = yield* walk(sweepRoot);

  const journal = yield* Journal;
  const events = yield* journal.readAll();
  const registry: IntakeRegistry = yield* gatherIntakeRegistry(events).pipe(
    Effect.provide(IndexServiceLayer(workspaceRoot)),
  );

  const rows: TriageRow[] = [];
  const skipped: TriageSkippedRow[] = [];
  const warnings: string[] = [...walkWarnings];

  for (const skillMdPath of skillMdFiles) {
    const dir = dirname(skillMdPath);
    const path = toPortablePath(workspaceRoot, dir);
    const bundleJsonPath = join(dir, "bundle.json");

    const alreadyAdopted = yield* fs
      .exists(bundleJsonPath)
      .pipe(Effect.mapError(toIOError(`could not check ${bundleJsonPath}`)));
    if (alreadyAdopted) {
      skipped.push({ path, reason: "already-adopted" });
      continue;
    }

    const content = yield* fs
      .readFileString(skillMdPath)
      .pipe(Effect.mapError(toIOError(`could not read ${skillMdPath}`)));
    const { data: frontmatter, warnings: frontmatterWarnings } = parseFrontmatter(content);
    for (const warning of frontmatterWarnings) {
      warnings.push(`${path}: ${warning}`);
    }

    const baseSlugName = basename(dir);
    const claimedName = stringField(frontmatter, "name") ?? baseSlugName;

    const markerExists = yield* fs
      .exists(join(dir, ADOPT_MARKER_FILENAME))
      .pipe(Effect.mapError(toIOError(`could not check ${join(dir, ADOPT_MARKER_FILENAME)}`)));
    const computedHash = yield* hashOutputTree(dir, { excludeTopLevel: ADOPT_EXCLUDED_NAMES });
    const evidence = classifyIntakeEvidence(computedHash, claimedName, markerExists, registry);

    const mechanicalCondition = yield* computeMechanicalCondition(dir, frontmatter, frontmatterWarnings);

    rows.push({
      name: claimedName,
      path,
      mechanicalCondition,
      evidence,
      decision: "keep",
      whose: defaultWhoseFor(evidence),
    });
  }

  return { rows, skipped, warnings, manifests, evalInfra } satisfies TriageWorkspaceResult;
});

// ---------------------------------------------------------------------------
// Render / parse -- the markdown table (house pattern: `RiskMap.ts`'s
// tolerant round-trip parser; the collect/validate machinery itself now
// lives in `MarkdownTable.ts`, shared by both -- only the row-level shape
// and the wording of what to tell the human are specific to this manifest).
// ---------------------------------------------------------------------------

type CardFieldKey = keyof DossierSeed;

/**
 * The card's free-text batch-form fields (issue #108): manifest column
 * label -> `TriageRow` key. ONE declaration drives all four sites that
 * know these fields -- the header, `renderManifest`'s row cells,
 * `parseManifest`'s lookups, and the receive path's stranded-answer
 * warning -- so a future card field is a one-place edit. Typed, not just
 * documented, against the shared shape: keys are `keyof DossierSeed`
 * (these answers ARE the dossier seed) and labels are `DossierSectionName`
 * (the sections they land in, `Dossier.ts`'s `DOSSIER_SECTIONS`) -- a
 * label or key that drifts from the dossier's own vocabulary is a compile
 * error, and the VocabLockstep suite asserts the membership at runtime
 * too. Exported for that test only.
 */
export const CARD_FIELDS: ReadonlyArray<readonly [label: DossierSectionName, key: CardFieldKey]> = [
  ["Job", "job"],
  ["Out-of-scope", "outOfScope"],
  ["Basis", "basis"],
];

const MANIFEST_HEADER: ReadonlyArray<string> = [
  "Name",
  "Path",
  "Mechanical Condition",
  "Registry Evidence",
  "Decision",
  "Whose",
  "Rights",
  "Stakes",
  "Hurts",
  "Priority",
  ...CARD_FIELDS.map(([label]) => label),
];

/** The normalized-known-columns lookup for `resolveColumns` -- built once here at module scope, never per parse (the schema is static; only a file's header varies). */
const KNOWN_MANIFEST_COLUMNS = knownColumnLookup(MANIFEST_HEADER);

const escapeCell = (value: string): string => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/**
 * `adopt-manifest.md`'s full render (issue #92 §CLI): a short human-facing
 * preamble plus the table, one row per candidate. The preamble states the
 * house law plainly, in the file the maker is about to hand-edit --
 * `--from-manifest` reads `Path` back (it is the row's key: which directory
 * to act on) plus every human column; `Name`/`Mechanical Condition`/
 * `Registry Evidence` round-trip for a human's own reference but are never
 * consulted to decide a row's action (they're machine columns `--triage`
 * regenerates, not load-bearing facts).
 */
export const renderManifest = (rows: ReadonlyArray<TriageRow>): string => {
  const lines: string[] = [
    "# Adopt Triage Manifest",
    "",
    "Edit the human columns -- Decision, Whose, Rights, Stakes, Hurts, Priority, Job, Out-of-scope, Basis -- then run `skillmaker adopt --from-manifest` to execute each row as an individual act (keep+mine -> adopt, keep+outside/came-back/unknown/receive -> receive, archive -> adopt + archive, skip -> untouched).",
    "",
    "Decision: keep | archive | skip. Whose: mine | outside | came-back | unknown | receive. Rights: ours | licensed | unclear (blank unless outside). Stakes: aside | load-bearing (blank ok). Hurts: free text (blank ok). Priority: a number, lower = more urgent (blank ok).",
    "",
    "Job / Out-of-scope / Basis are card fields (free text, blank ok = not asked): these answers land in the adopted skill's dossier. Entry stage is never asked -- it is derived from what's observably in the directory (runnable, complete SKILL.md -> Proof).",
    "",
    `| ${MANIFEST_HEADER.join(" | ")} |`,
    `|${MANIFEST_HEADER.map(() => " --- ").join("|")}|`,
    ...rows.map((row) =>
      `| ${[
        row.name,
        row.path,
        renderMechanicalCondition(row.mechanicalCondition),
        renderEvidence(row.evidence),
        row.decision,
        row.whose,
        row.rights ?? "",
        row.stakes ?? "",
        row.hurts ?? "",
        row.priority !== undefined ? String(row.priority) : "",
        ...CARD_FIELDS.map(([, key]) => row[key] ?? ""),
      ]
        .map(escapeCell)
        .join(" | ")} |`,
    ),
    "",
  ];
  return lines.join("\n");
};

export interface ParseManifestResult {
  readonly rows: ReadonlyArray<TriageRow>;
  readonly warnings: ReadonlyArray<string>;
}

const RIGHTS_VALUES: ReadonlyArray<IntakeRights> = ["ours", "licensed", "unclear"];
const isIntakeRights = (value: string): value is IntakeRights =>
  (RIGHTS_VALUES as ReadonlyArray<string>).includes(value);

/**
 * One tolerant enum-cell parse, shared by every closed-vocabulary column
 * below (`Decision`/`Whose`/`Rights`/`Stakes` -- columns that used to
 * hand-copy this same trim/validate/warn shape).
 * `fallback` doubles as both the blank-cell default AND the unrecognized-
 * cell default (the deferral ruling treats them the same: never a false
 * fact, always a named default) -- `undefined` for a column where blank is
 * itself a legitimate answer (`Rights`/`Stakes`, warned as "left blank"),
 * a concrete value for a column that always resolves to something
 * (`Decision`/`Whose`, warned as "defaulted to ...").
 */
const parseEnumCell = <T extends string>(
  raw: string,
  isValid: (value: string) => value is T,
  fallback: T | undefined,
  label: string,
  path: string,
  warnings: string[],
): T | undefined => {
  const trimmed = raw.trim();
  if (isValid(trimmed)) {
    return trimmed;
  }
  if (trimmed.length > 0) {
    warnings.push(
      fallback !== undefined
        ? `adopt-manifest.md: row "${path}" has unrecognized ${label} "${trimmed}"; defaulted to "${fallback}"`
        : `adopt-manifest.md: row "${path}" has unrecognized ${label} "${trimmed}"; left blank`,
    );
  }
  return fallback;
};

/**
 * Tolerant round-trip parse of `adopt-manifest.md` (house pattern:
 * `RiskMap.ts`'s markdown-table parser). Deferral defaults, never a false
 * fact (issue #92's ruling, applied at parse time too): a blank/unparseable
 * `decision` defaults to `"keep"`; a blank/unparseable `whose` defaults to
 * `"unknown"` -- a first-class recorded answer, never silently `"mine"`.
 * `rights`/`stakes`/`hurts`/`priority`/`job`/`outOfScope`/`basis` stay
 * `undefined` when blank -- blank is a legitimate answer (not asked = honest
 * gap, issue #108), not a defect to paper over.
 *
 * Columns are resolved BY HEADER NAME, not position (issue #108,
 * `MarkdownTable.ts`'s `resolveColumns` against `KNOWN_MANIFEST_COLUMNS`):
 * each known column name is mapped to its index in THAT file's own header.
 * That is what makes an old manifest still read after the
 * column set changed: a pre-#108 manifest's retired `Maturity` column is
 * warned about ONCE ("ignoring unrecognized column") and its cells are
 * never read -- never preserved into execution, never a parse failure --
 * and its missing `Job`/`Out-of-scope`/`Basis` columns simply read as
 * not-asked. Warn, never fail, throughout.
 */
export const parseManifest = (content: string): ParseManifestResult => {
  const warnings: string[] = [];
  const lines = content.split(/\r?\n/);
  const collected = collectTableLines(lines);
  if (collected.kind === "no-table") {
    warnings.push("adopt-manifest.md: no table found; no rows parsed");
    return { rows: [], warnings };
  }
  if (collected.kind === "invalid-header") {
    warnings.push("adopt-manifest.md: could not find a valid table header/separator; no rows parsed");
    return { rows: [], warnings };
  }
  const { header, dataLines } = collected;

  const headerCells = splitTableCells(header);
  const { columnIndex, unknownColumns } = resolveColumns(headerCells, KNOWN_MANIFEST_COLUMNS);
  for (const column of unknownColumns) {
    // Warn once per unknown column (e.g. the retired pre-#108 `Maturity`
    // column), then ignore its cells entirely -- never read into
    // execution, never a failure.
    warnings.push(`adopt-manifest.md: ignoring unrecognized column "${column}" (its cells are not read)`);
  }

  if (!columnIndex.has("Path")) {
    warnings.push('adopt-manifest.md: table header has no "Path" column; no rows parsed');
    return { rows: [], warnings };
  }

  const rows: TriageRow[] = [];
  for (const line of dataLines) {
    const cells = splitTableCells(line);
    if (cells.length < headerCells.length) {
      warnings.push(
        `adopt-manifest.md: could not parse row "${line.trim()}" (expected ${headerCells.length} columns)`,
      );
      continue;
    }
    // A column absent from THIS file's header reads as blank (not asked).
    const cell = (column: string): string => cellByName(cells, columnIndex, column);

    const path = cell("Path").trim();
    if (path.length === 0) {
      warnings.push(`adopt-manifest.md: could not parse row "${line.trim()}" (empty Path cell)`);
      continue;
    }

    const decision = parseEnumCell(cell("Decision"), isTriageDecision, "keep", "Decision", path, warnings) ?? "keep";
    const whose = parseEnumCell(cell("Whose"), isTriageWhose, "unknown", "Whose", path, warnings) ?? "unknown";
    const rights = parseEnumCell(cell("Rights"), isIntakeRights, undefined, "Rights", path, warnings);
    const stakes = parseEnumCell(cell("Stakes"), isTriageStakes, undefined, "Stakes", path, warnings);

    const freeText = (raw: string): string | undefined => {
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };
    const hurts = freeText(cell("Hurts"));
    const card: Partial<Record<CardFieldKey, string>> = {};
    for (const [label, key] of CARD_FIELDS) {
      const value = freeText(cell(label));
      if (value !== undefined) {
        card[key] = value;
      }
    }

    const priorityRaw = cell("Priority").trim();
    let priority: number | undefined;
    if (priorityRaw.length > 0) {
      const parsed = Number.parseInt(priorityRaw, 10);
      if (Number.isNaN(parsed)) {
        warnings.push(`adopt-manifest.md: row "${path}" has unparseable Priority "${priorityRaw}"; left blank`);
      } else {
        priority = parsed;
      }
    }

    rows.push({
      name: cell("Name").trim(),
      path,
      mechanicalCondition: parseMechanicalCondition(cell("Mechanical Condition")),
      evidence: parseEvidence(cell("Registry Evidence")),
      decision,
      whose,
      ...(rights !== undefined ? { rights } : {}),
      ...(stakes !== undefined ? { stakes } : {}),
      ...(hurts !== undefined ? { hurts } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...card,
    });
  }

  return { rows, warnings };
};

// ---------------------------------------------------------------------------
// Execution -- `adopt --from-manifest`
// ---------------------------------------------------------------------------

export type ExecuteRowOutcome =
  | { readonly kind: "adopted"; readonly path: string; readonly slug: string }
  | { readonly kind: "received"; readonly path: string; readonly intake: string; readonly verdict: IntakeVerdict }
  | { readonly kind: "archived"; readonly path: string; readonly slug: string }
  | { readonly kind: "skipped"; readonly path: string; readonly reason: string }
  | { readonly kind: "errored"; readonly path: string; readonly message: string };

export interface ExecuteManifestRowResult {
  readonly outcome: ExecuteRowOutcome;
  readonly todoMinted: boolean;
  /** Row-level advisories (issue #108, warn-never-fail): e.g. card answers on a receive row that land nowhere until a door grants identity. Never blocks the row's own outcome. */
  readonly warnings: ReadonlyArray<string>;
}

export interface ExecuteManifestSummary {
  readonly adopted: number;
  readonly received: number;
  readonly archived: number;
  readonly skipped: number;
  readonly errored: number;
  readonly todosMinted: number;
  readonly outcomes: ReadonlyArray<ExecuteRowOutcome>;
  /** Every row's advisories, collected in row order (issue #108, warn-never-fail). */
  readonly warnings: ReadonlyArray<string>;
}

const newTodoId = (): string => `td-${crypto.randomUUID()}`;
const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

const mintHurtsTodo = Effect.fn("Triage.mintHurtsTodo")(function* (
  row: TriageRow,
  actor: Actor,
  ref: string,
  bundle: string | undefined,
) {
  if (row.hurts === undefined) {
    return false;
  }
  const journal = yield* Journal;
  const priority = row.priority ?? DEFAULT_PRIORITY_BY_KIND.task;
  const todo = {
    id: newTodoId(),
    kind: "task" as const,
    status: "open" as const,
    title: row.hurts,
    priority,
    created: todayIsoDate(),
    ...(bundle !== undefined ? { bundle } : {}),
    source: actor,
    origin: { kind: "intake" as const, intakeId: ref },
  } satisfies Todo;
  yield* journal.append({ type: "todo.opened", actor, payload: { todo } });
  return true;
});

/**
 * One `bundle.stage_changed` from `"idea"` to the DERIVED entry stage, when
 * past idea (issue #108, `deriveEntryStage`). `parses`/`complete` come from
 * the frontmatter parse `adoptDirectoryInPlace` just performed on the
 * `SKILL.md` this very row read off disk -- observables at execution time,
 * never read back from the manifest's hand-editable Mechanical Condition
 * cell (machine columns are for a human's reference, not load-bearing for
 * execution; an entry stage must come from observables, not from a cell a
 * maker could have edited into testimony). No `scanFixtures` walk here:
 * `deriveEntryStage` consults only these two facts (`hasEvals` plays no
 * part), so the fixture scan would be wasted I/O over a tree
 * `computeBundleHashes` is about to walk anyway. NO `override` on the
 * event: this is not a human overriding the guard, it is the system's own
 * placement at birth -- the guard (`Machine.ts`'s `checkTransition`) is
 * enforced at the interactive write paths (`advance`, the server's POST
 * allowlist), not here.
 */
const advanceToDerivedEntryStage = Effect.fn("Triage.advanceToDerivedEntryStage")(function* (
  slug: string,
  frontmatter: Frontmatter,
  frontmatterWarnings: ReadonlyArray<string>,
  actor: Actor,
) {
  const parses = !frontmatterWarnings.some((warning) => warning.includes(NO_FRONTMATTER_MARKER));
  const complete =
    stringField(frontmatter, "name") !== undefined && stringField(frontmatter, "description") !== undefined;
  const to = deriveEntryStage({ parses, complete });
  if (to === "idea") {
    return;
  }
  const journal = yield* Journal;
  yield* journal.append({
    type: "bundle.stage_changed",
    actor,
    payload: { bundle: slug, from: "idea", to, reason: TRIAGE_ENTRY_STAGE_REASON },
  });
});

export interface ExecuteManifestOptions {
  readonly root: string;
  readonly actor: Actor;
  /** Slugs already in the corpus, seeded once before the first row (issue #92: threaded across every row in this run so two rows in the same manifest never collide, same discipline `adoptWorkspace`'s own sweep already has). */
  readonly usedSlugs: Set<string>;
}

/**
 * Executes one manifest row (issue #92 §CLI). No tripwire re-check here --
 * by the time a row reaches `--from-manifest`, a human has already seen
 * its evidence (via `--triage`'s own manifest) and made an explicit
 * decision; re-challenging it would defeat the manifest's purpose. Never
 * throws for an ordinary bad row (vanished directory, already-adopted) --
 * those become an `"errored"`/`"skipped"` outcome so the caller can report
 * every row, no silent truncation.
 */
export const executeManifestRow = Effect.fn("Triage.executeManifestRow")(function* (
  row: TriageRow,
  options: ExecuteManifestOptions,
) {
  const fs = yield* FileSystem;
  const { root, actor, usedSlugs } = options;
  const dir = join(root, ...row.path.split("/"));

  if (row.decision === "skip") {
    return {
      outcome: { kind: "skipped", path: row.path, reason: "skip" },
      todoMinted: false,
      warnings: [],
    } satisfies ExecuteManifestRowResult;
  }

  const dirExists = yield* fs.exists(dir).pipe(Effect.mapError(toIOError(`could not check ${dir}`)));
  if (!dirExists) {
    return {
      outcome: { kind: "errored", path: row.path, message: `directory "${row.path}" no longer exists` },
      todoMinted: false,
      warnings: [],
    } satisfies ExecuteManifestRowResult;
  }

  const bundleJsonPath = join(dir, "bundle.json");
  const alreadyAdopted = yield* fs
    .exists(bundleJsonPath)
    .pipe(Effect.mapError(toIOError(`could not check ${bundleJsonPath}`)));

  if (row.decision === "archive" || row.whose === "mine") {
    if (alreadyAdopted) {
      return {
        outcome: { kind: "skipped", path: row.path, reason: "already-adopted" },
        todoMinted: false,
        warnings: [],
      } satisfies ExecuteManifestRowResult;
    }

    // The same single write path plain adopt's sweep and Route.ts's
    // `new`/`fork` use (`Adopt.ts`'s `adoptDirectoryInPlace`) -- no
    // tripwire here: the human already saw this row's evidence in the
    // manifest and decided anyway. The row's card answers
    // (Job/Out-of-scope/Basis, issue #108) seed the dossier this adopt
    // creates -- `TriageRow extends DossierSeed`, so the row IS the seed,
    // no field-by-field copy to drift. `writeDossierScaffold` never
    // clobbers an existing file, so a dossier that already traveled with
    // the directory wins over the manifest's answers.
    const skillMdPath = join(dir, "SKILL.md");
    const skillMdContent = yield* fs
      .readFileString(skillMdPath)
      .pipe(Effect.mapError(toIOError(`could not read ${skillMdPath}`)));
    const wrapped = yield* adoptDirectoryInPlace({
      dir,
      skillMdContent,
      slugBase: basename(dir),
      usedSlugs,
      dossierSeed: row,
    });
    usedSlugs.add(wrapped.slug);

    const journal = yield* Journal;
    const bundleCreated = yield* journal.append({
      type: "bundle.created",
      actor,
      idempotencyKey: `bundle.created:${wrapped.slug}`,
      payload: { bundle: wrapped.slug },
    });

    // The same pathname rule the sweep applies (`lifecycleFromPath`,
    // exported from `Adopt.ts`): a kept row under `deprecated/` still
    // enters archived. `row.path` is stored forward-slash; rejoin with the
    // platform separator before the segment check.
    const { lifecycle } = lifecycleFromPath(row.path.split("/").join(sep));
    const isArchived = row.decision === "archive" || lifecycle === "deprecated";
    if (isArchived) {
      yield* journal.append({
        type: "bundle.archived",
        actor,
        idempotencyKey: `bundle.archived:${wrapped.slug}`,
        payload: { bundle: wrapped.slug },
      });
    } else {
      yield* advanceToDerivedEntryStage(wrapped.slug, wrapped.frontmatter, wrapped.warnings, actor);
    }

    const { designHash, outputHash } = yield* computeBundleHashes(dir, "in-place");
    yield* recordSkillVersion(wrapped.slug, actor, designHash, outputHash, { label: "adopted" });

    const todoMinted = yield* mintHurtsTodo(row, actor, bundleCreated.event.id, wrapped.slug);

    return {
      outcome: isArchived
        ? { kind: "archived", path: row.path, slug: wrapped.slug }
        : { kind: "adopted", path: row.path, slug: wrapped.slug },
      todoMinted,
      warnings: [],
    } satisfies ExecuteManifestRowResult;
  }

  // keep + (outside | came-back | unknown | receive): the dock's door, one
  // directory at a time (`receiveCrate`, `Receive.ts`). The row's
  // stakes/hurts land as the event's own STRUCTURED testimony fields
  // (issue #108) -- never flattened into `notes` prose (the old
  // `composeReceiveNotes` is gone; `notes` is for genuinely free-text notes
  // only, and no writer here has one).
  const warnings: string[] = [];
  // A crate has no dossier -- the card's Job/Out-of-scope/Basis answers have
  // nowhere to land until one of the five doors grants identity. Warn, never
  // fail (issue #108): the row still executes; the answers are just not
  // silently recorded anywhere.
  const strandedCardAnswers = CARD_FIELDS.filter(([, key]) => row[key] !== undefined).map(([label]) => label);
  if (strandedCardAnswers.length > 0) {
    warnings.push(
      `adopt-manifest.md: row "${row.path}" answered ${strandedCardAnswers.join("/")} but routes to the dock -- a crate has no dossier, so these answers land nowhere until a door grants identity`,
    );
  }

  const received = yield* receiveCrate({
    workspaceRoot: root,
    sourcePath: dir,
    source: row.whose,
    claimedName: row.name,
    ...(row.rights !== undefined ? { rights: row.rights } : {}),
    ...(row.stakes !== undefined ? { stakes: row.stakes } : {}),
    ...(row.hurts !== undefined ? { hurts: row.hurts } : {}),
    actor,
  });

  const todoMinted = yield* mintHurtsTodo(row, actor, received.intake, undefined);

  return {
    outcome: { kind: "received", path: row.path, intake: received.intake, verdict: received.verdict },
    todoMinted,
    warnings,
  } satisfies ExecuteManifestRowResult;
});

/**
 * Executes every row in `rows`, in order, as individual acts (issue #92
 * §CLI). One row's failure never stops another's -- collected as an
 * `"errored"` outcome, reported in the summary alongside every other row
 * (no silent truncation).
 */
export const executeManifest = Effect.fn("Triage.executeManifest")(function* (
  root: string,
  rows: ReadonlyArray<TriageRow>,
  actor: Actor,
) {
  const journal = yield* Journal;
  const events = yield* journal.readAll();
  const registry = yield* gatherIntakeRegistry(events).pipe(Effect.provide(IndexServiceLayer(root)));
  const usedSlugs = new Set(registry.bundles.map((bundle) => bundle.slug));

  const outcomes: ExecuteRowOutcome[] = [];
  const warnings: string[] = [];
  let adopted = 0;
  let received = 0;
  let archived = 0;
  let skipped = 0;
  let errored = 0;
  let todosMinted = 0;

  for (const row of rows) {
    const result = yield* executeManifestRow(row, { root, actor, usedSlugs });
    outcomes.push(result.outcome);
    warnings.push(...result.warnings);
    if (result.todoMinted) {
      todosMinted++;
    }
    switch (result.outcome.kind) {
      case "adopted":
        adopted++;
        break;
      case "received":
        received++;
        break;
      case "archived":
        archived++;
        break;
      case "skipped":
        skipped++;
        break;
      case "errored":
        errored++;
        break;
    }
  }

  return {
    adopted,
    received,
    archived,
    skipped,
    errored,
    todosMinted,
    outcomes,
    warnings,
  } satisfies ExecuteManifestSummary;
});
