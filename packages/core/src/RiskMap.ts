/**
 * `evals/risk-map.md` — the AUTHORED COVERAGE AXIS ONLY (data-model.md
 * §2.6). Frontmatter (`bundle`) + a markdown table:
 *
 * ```markdown
 * ---
 * bundle: frame-the-problem
 * ---
 * | Risk | Description | Coverage | Fixture |
 * |---|---|---|---|
 * | IN-1 | Empty/thin input | ● covered | refusal-thin-input |
 * ```
 *
 * There is NO results column, ever (data-model.md §2.6) -- validation is
 * computed from graded runs and joined in the viewer at read time (Phase 9),
 * never authored here and never parsed here. A missing `risk-map.md` is
 * fine: empty rows, no warning -- it's optional until authored.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { WorkspaceIOError } from "./Errors.ts";
import { RISK_FAMILIES, isKnownRiskFamily, riskFamily, type FixtureCaseRecord } from "./Fixtures.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

export const COVERAGE_VALUES = ["covered", "partial", "gap", "n/a"] as const;
export type CoverageValue = (typeof COVERAGE_VALUES)[number];

const COVERAGE_GLYPHS: ReadonlyArray<readonly [string, CoverageValue]> = [
  ["●", "covered"],
  ["◐", "partial"],
  ["○", "gap"],
];

/**
 * Parses a coverage cell that may be a glyph+word (`"● covered"`), just a
 * word (`"covered"`), or just a glyph (`"●"`) -- data-model.md §2.6 shows
 * the glyph+word form, but the words alone are accepted too (task spec).
 */
export const parseCoverageCell = (cell: string): CoverageValue | undefined => {
  const trimmed = cell.trim();
  const lower = trimmed.toLowerCase();
  for (const word of COVERAGE_VALUES) {
    if (lower.includes(word)) {
      return word;
    }
  }
  for (const [glyph, value] of COVERAGE_GLYPHS) {
    if (trimmed.includes(glyph)) {
      return value;
    }
  }
  return undefined;
};

/** One row of the authored coverage table. */
export interface RiskRow {
  readonly riskId: string;
  readonly family: string;
  readonly description: string;
  readonly coverage: CoverageValue;
  /** `undefined` for an empty/em-dash cell -- no fixture buys this risk's coverage yet. */
  readonly fixtureCase?: string;
}

export interface ParseRiskMapResult {
  readonly rows: ReadonlyArray<RiskRow>;
  readonly warnings: ReadonlyArray<string>;
}

/** A markdown table separator row, e.g. `|---|---|---|---|`. */
const isSeparatorRow = (line: string): boolean =>
  /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());

const isTableRow = (line: string): boolean => line.trim().startsWith("|");

/** Splits `| a | b | c |` into `["a", "b", "c"]`, tolerating a missing leading/trailing pipe. */
const splitCells = (line: string): string[] => {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
};

const EMPTY_FIXTURE_CELLS = new Set(["", "-", "—", "–", "n/a"]);

/**
 * Parses `evals/risk-map.md`'s frontmatter + table (data-model.md §2.6).
 * `riskMapPath` missing entirely is fine -- returns empty rows, no warning
 * (it's optional until authored). Malformed rows and unbanded risk-family
 * prefixes are warnings, never failures (Part 3 ruling I). Fixture
 * cross-reference against actual fixture cases is NOT done here -- see
 * `checkCoverage`, which the caller runs once it also has the scanned
 * fixtures.
 */
export const parseRiskMap = Effect.fn("RiskMap.parseRiskMap")(function* (riskMapPath: string) {
  const fs = yield* FileSystem;
  const warnings: string[] = [];

  const exists = yield* fs.exists(riskMapPath).pipe(Effect.mapError(toIOError(`could not check ${riskMapPath}`)));
  if (!exists) {
    return { rows: [], warnings };
  }

  const content = yield* fs
    .readFileString(riskMapPath)
    .pipe(Effect.mapError(toIOError(`could not read ${riskMapPath}`)));

  // Strip frontmatter, if present -- only `bundle:` is meaningful, and it's
  // purely informational here (the caller already knows which bundle this
  // file belongs to from the directory it scanned).
  let body = content;
  const frontmatterMatch = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  if (frontmatterMatch !== null) {
    body = content.slice(frontmatterMatch[0].length);
  }

  const lines = body.split(/\r?\n/);
  const tableLines: string[] = [];
  for (const line of lines) {
    if (isTableRow(line)) {
      tableLines.push(line);
    } else if (tableLines.length > 0) {
      // A table is one contiguous block -- stop at the first non-table line
      // after we've started collecting one.
      break;
    }
  }

  if (tableLines.length === 0) {
    return { rows: [], warnings };
  }

  const [header, separator, ...dataLines] = tableLines;
  if (header === undefined || separator === undefined || !isSeparatorRow(separator)) {
    warnings.push("evals/risk-map.md: could not find a valid table header/separator; no rows parsed");
    return { rows: [], warnings };
  }

  const rows: RiskRow[] = [];
  for (const line of dataLines) {
    const cells = splitCells(line);
    if (cells.length < 3) {
      warnings.push(`evals/risk-map.md: could not parse row "${line.trim()}" (expected 4 columns)`);
      continue;
    }
    const [riskIdCell, descriptionCell, coverageCell, fixtureCell] = cells;
    const riskId = (riskIdCell ?? "").trim();
    if (riskId.length === 0) {
      warnings.push(`evals/risk-map.md: could not parse row "${line.trim()}" (empty Risk cell)`);
      continue;
    }

    const family = riskFamily(riskId);
    if (!isKnownRiskFamily(family)) {
      warnings.push(
        `evals/risk-map.md: risk id "${riskId}" does not band into a known family (expected ${RISK_FAMILIES.join("|")} prefix)`,
      );
    }

    const coverage = parseCoverageCell(coverageCell ?? "");
    if (coverage === undefined) {
      warnings.push(
        `evals/risk-map.md: could not parse coverage cell "${(coverageCell ?? "").trim()}" for risk "${riskId}" (expected ●/◐/○ or covered|partial|gap|n/a)`,
      );
      continue;
    }

    const fixtureRaw = (fixtureCell ?? "").trim();
    const fixtureCase = EMPTY_FIXTURE_CELLS.has(fixtureRaw.toLowerCase()) ? undefined : fixtureRaw;

    rows.push({
      riskId,
      family,
      description: (descriptionCell ?? "").trim(),
      coverage,
      ...(fixtureCase !== undefined ? { fixtureCase } : {}),
    });
  }

  return { rows, warnings };
});

/**
 * Cross-checks the risk map's `Fixture` column against the actually-scanned
 * fixture cases (data-model.md §2.6/§2.11) -- a warning, never a failure
 * (Part 3 ruling I). Kept separate from `parseRiskMap` because it needs both
 * inputs, which only the caller (IndexService.rebuild) has at once.
 */
export const checkCoverage = (
  riskRows: ReadonlyArray<RiskRow>,
  cases: ReadonlyArray<Pick<FixtureCaseRecord, "caseName">>,
): ReadonlyArray<string> => {
  const caseNames = new Set(cases.map((c) => c.caseName));
  const warnings: string[] = [];
  for (const row of riskRows) {
    if (row.fixtureCase !== undefined && !caseNames.has(row.fixtureCase)) {
      warnings.push(
        `evals/risk-map.md: risk "${row.riskId}" references fixture "${row.fixtureCase}" which does not exist`,
      );
    }
  }
  return warnings;
};
