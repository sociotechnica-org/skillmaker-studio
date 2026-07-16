/**
 * `skills/<slug>/dossier.md` (issue #94, `Mechanism - Receiving Dock.md`
 * §HOW's "the dossier"): the progressive, per-kept-skill context-of-use
 * record -- Job (one line), Contexts (any number, each a named contract:
 * handoff-in, what downstream reads, environment notes, stakes), Out-of-
 * scope, Basis, Evidence, Fit criterion. Every section is optional and
 * unanswered fields are honest gaps ("fit criterion: unrecorded"), never a
 * block on anything.
 *
 * Frontmatter (`bundle:`) + free-prose H2 sections, NOT another markdown
 * table (house pattern split, `RiskMap.ts`/`MarkdownTable.ts`'s tabular
 * parser is for genuinely columnar data -- a dossier's sections are prose a
 * maker writes by hand, closer to `design.md`'s own skeleton than to
 * `risk-map.md`'s table). Still the same tolerance law (Part 3 ruling I):
 * parse permissively, warn never fail, and a heading this scanner doesn't
 * recognize is preserved (named and returned) rather than silently dropped.
 *
 * A section whose body is empty once its scaffold comment is stripped reads
 * as unrecorded (`undefined`) -- that's how the scaffold's own comment-
 * hinted empty sections (`writeDossierScaffold` below) round-trip as
 * "nothing answered yet" without a separate "is this just the hint text"
 * flag.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { WorkspaceIOError } from "./Errors.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

/** The dossier's six known H2 sections, in the order the design doc lists them (`Mechanism - Receiving Dock.md` §HOW). */
export const DOSSIER_SECTIONS = ["Job", "Contexts", "Out-of-scope", "Basis", "Evidence", "Fit criterion"] as const;
export type DossierSectionName = (typeof DOSSIER_SECTIONS)[number];

/**
 * One named context under `## Contexts` (Director ruling, 2026-07-16: "jobs
 * singular, contexts plural" -- any number of named contracts on the one
 * job). `body` is free prose, not parsed into handoff-in/downstream-reads/
 * environment/stakes sub-fields -- those are the maker's own words under a
 * named `### <context>` heading, not another structured record (this issue
 * adds only the field + scanner tolerance, not per-context coverage
 * display -- there is nothing downstream that needs `body` split further
 * yet).
 */
export interface DossierContext {
  readonly name: string;
  readonly body: string;
}

/** A heading this scanner doesn't recognize -- preserved (named + its body kept) rather than silently dropped, so a maker-added section survives being scanned even though nothing here knows what to do with it yet. */
export interface DossierUnknownSection {
  readonly heading: string;
  readonly body: string;
}

/** All six sections optional (data-model.md's honesty law): `undefined`/empty array is a gap, not a defect. */
export interface DossierSections {
  readonly job?: string;
  readonly contexts: ReadonlyArray<DossierContext>;
  readonly outOfScope?: string;
  readonly basis?: string;
  readonly evidence?: string;
  readonly fitCriterion?: string;
}

export interface ParseDossierResult {
  readonly sections: DossierSections;
  readonly warnings: ReadonlyArray<string>;
  readonly unknownSections: ReadonlyArray<DossierUnknownSection>;
}

const stripComments = (text: string): string => text.replace(/<!--[\s\S]*?-->/g, "").trim();

interface RawSection {
  readonly heading: string;
  readonly body: string;
}

/** Splits a dossier's body (frontmatter + top `# Dossier — ...` title already stripped) into H2 blocks, in file order. */
const collectH2Sections = (body: string): ReadonlyArray<RawSection> => {
  const lines = body.split(/\r?\n/);
  const sections: RawSection[] = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match !== null && match[1] !== undefined) {
      if (current !== undefined) {
        sections.push({ heading: current.heading, body: current.lines.join("\n") });
      }
      current = { heading: match[1], lines: [] };
      continue;
    }
    if (current !== undefined) {
      current.lines.push(line);
    }
  }
  if (current !== undefined) {
    sections.push({ heading: current.heading, body: current.lines.join("\n") });
  }
  return sections;
};

/** Splits a `## Contexts` section's body into named `### <context>` subsections. Tolerant: text before the first H3, or a body with no H3 at all, produces a warning rather than a dropped/misattributed context. */
const collectH3Contexts = (
  body: string,
  warnings: string[],
): ReadonlyArray<DossierContext> => {
  const lines = body.split(/\r?\n/);
  const contexts: DossierContext[] = [];
  let current: { name: string; lines: string[] } | undefined;
  let preamble = "";
  for (const line of lines) {
    const match = /^###\s+(.+?)\s*$/.exec(line);
    if (match !== null && match[1] !== undefined) {
      if (current !== undefined) {
        contexts.push({ name: current.name, body: stripComments(current.lines.join("\n")) });
      }
      current = { name: match[1], lines: [] };
      continue;
    }
    if (current !== undefined) {
      current.lines.push(line);
    } else {
      preamble += `${line}\n`;
    }
  }
  if (current !== undefined) {
    contexts.push({ name: current.name, body: stripComments(current.lines.join("\n")) });
  }

  if (contexts.length === 0 && stripComments(preamble).length > 0) {
    warnings.push(
      'dossier.md: "Contexts" section has content but no named context (expected a "### <context name>" heading); no context recorded',
    );
  }

  return contexts;
};

const normalizeHeading = (heading: string): string => heading.trim().toLowerCase();

const KNOWN_HEADINGS: ReadonlySet<string> = new Set(DOSSIER_SECTIONS.map(normalizeHeading));

/**
 * Parses `skills/<slug>/dossier.md` (issue #94). A missing file is fine --
 * every section reads as an honest gap, no warning (same "optional until
 * authored" treatment `RiskMap.ts`'s `parseRiskMap` gives a missing
 * `risk-map.md`). Malformed/unrecognized content is a warning, never a
 * failure (Part 3 ruling I).
 */
export const parseDossier = Effect.fn("Dossier.parseDossier")(function* (dossierPath: string) {
  const fs = yield* FileSystem;
  const warnings: string[] = [];
  const unknownSections: DossierUnknownSection[] = [];

  const exists = yield* fs.exists(dossierPath).pipe(Effect.mapError(toIOError(`could not check ${dossierPath}`)));
  if (!exists) {
    return {
      sections: { contexts: [] },
      warnings,
      unknownSections,
    } satisfies ParseDossierResult;
  }

  const content = yield* fs
    .readFileString(dossierPath)
    .pipe(Effect.mapError(toIOError(`could not read ${dossierPath}`)));

  let body = content;
  const frontmatterMatch = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  if (frontmatterMatch !== null) {
    body = content.slice(frontmatterMatch[0].length);
  }
  // Drop a leading `# Dossier — <Name>` title line, if present -- purely
  // decorative (the scaffold writes one), not a section.
  body = body.replace(/^\s*#\s+.*\r?\n/, "");

  const rawSections = collectH2Sections(body);
  let job: string | undefined;
  let contexts: ReadonlyArray<DossierContext> = [];
  let outOfScope: string | undefined;
  let basis: string | undefined;
  let evidence: string | undefined;
  let fitCriterion: string | undefined;

  for (const raw of rawSections) {
    const key = normalizeHeading(raw.heading);
    if (!KNOWN_HEADINGS.has(key)) {
      unknownSections.push({ heading: raw.heading, body: stripComments(raw.body) });
      continue;
    }
    switch (key) {
      case "job": {
        const text = stripComments(raw.body);
        job = text.length > 0 ? text : undefined;
        break;
      }
      case "contexts": {
        contexts = collectH3Contexts(raw.body, warnings);
        break;
      }
      case "out-of-scope": {
        const text = stripComments(raw.body);
        outOfScope = text.length > 0 ? text : undefined;
        break;
      }
      case "basis": {
        const text = stripComments(raw.body);
        basis = text.length > 0 ? text : undefined;
        break;
      }
      case "evidence": {
        const text = stripComments(raw.body);
        evidence = text.length > 0 ? text : undefined;
        break;
      }
      case "fit criterion": {
        const text = stripComments(raw.body);
        fitCriterion = text.length > 0 ? text : undefined;
        break;
      }
    }
  }

  return {
    sections: {
      ...(job !== undefined ? { job } : {}),
      contexts,
      ...(outOfScope !== undefined ? { outOfScope } : {}),
      ...(basis !== undefined ? { basis } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
      ...(fitCriterion !== undefined ? { fitCriterion } : {}),
    },
    warnings,
    unknownSections,
  } satisfies ParseDossierResult;
});

/**
 * `dossier.md`'s scaffold (issue #94 §CLI/§Scaffold): comment-hinted empty
 * sections, written by `skillmaker new` (`WorkspaceService.ts`'s
 * `createBundle`) and `Adopt.ts`'s `adoptDirectoryInPlace` (the one write
 * path shared by plain `adopt`, `Route.ts`'s `new`/`fork`, and the triage
 * manifest's per-row execution). Shows exactly ONE context stub, inside the
 * guidance comment rather than as a real `### <name>` heading -- a real
 * heading would register an actual (if empty) context and defeat the
 * "unanswered fields display as honest gaps" law; the scaffold must produce
 * a true gap (zero contexts) until a maker names one.
 *
 * Deliberately does NOT seed from the triage manifest's `stakes` answer
 * (issue #94 judgment call): `Triage.ts`'s `composeReceiveNotes` already
 * folds `stakes` into the free-text `notes` on the *received* event, mixed
 * with `hurts` in one joined string -- there is no clean, always-present
 * seam to pull a structured "aside"/"load-bearing" value back out of that
 * prose without either mis-parsing it or fabricating structure the ledger
 * never recorded. `dossier.md` is also scaffolded from two OTHER call sites
 * (`skillmaker new`, plain `adopt`'s sweep) that never see a triage row at
 * all, so a manifest-only seed would be inconsistent across the three
 * scaffolders besides. Every scaffold writes the same honest-empty template;
 * stakes stays exactly where it already lives (the received event's notes),
 * never forced into a second, less honest home.
 */
export const writeDossierScaffold = Effect.fn("Dossier.writeDossierScaffold")(function* (
  dir: string,
  slug: string,
  name: string,
) {
  const fs = yield* FileSystem;
  const dossierPath = `${dir}/dossier.md`;
  const alreadyExists = yield* fs
    .exists(dossierPath)
    .pipe(Effect.mapError(toIOError(`could not check ${dossierPath}`)));
  if (alreadyExists) {
    // Files are canonical for content -- never clobber a dossier a maker
    // (or a foreign arrival) already wrote.
    return;
  }
  yield* fs
    .writeFileString(dossierPath, dossierSkeleton(slug, name))
    .pipe(Effect.mapError(toIOError(`could not write ${dossierPath}`)));
});

const dossierSkeleton = (slug: string, name: string): string =>
  `---
bundle: ${slug}
---
# Dossier — ${name}

## Job
<!-- One line: what does this skill do? -->

## Contexts
<!-- Any number of named contexts this skill runs in -- a chain position, an
     agent persona, an employee-wide deployment (job stays, context varies:
     that's modular reuse working as intended). Walk the last real time this
     ran: what came right before it, and what happened right after? For each
     context, name it with a heading and describe its handoff-in (what it
     receives from upstream), what downstream actually reads from its output,
     environment notes (multi-turn? tools alongside? human review before it
     ships?), and stakes (aside | load-bearing). Example shape:

     ### <context name>
     Handoff-in: ...
     Downstream reads: ...
     Environment: ...
     Stakes: aside | load-bearing
-->

## Out-of-scope
<!-- Paired with Job (Model Cards): what should this explicitly NOT be used
     for? -->

## Basis
<!-- A named framework, or someone's way of doing it -- record who, so an
     ambiguous case has a source of truth to ask. -->

## Evidence
<!-- Does performance data exist? Where does it live? Do we have permission to
     use it? If yes: the first Lab act is reviewing real traces and coding
     failures before writing evals. If no: walk 3-5 cases by hand -- this
     interview is the first data-gathering event. -->

## Fit criterion
<!-- If you had to write one pass/fail test today, what would it check? The
     answer seeds the first fixture's answer key. -->
`;
