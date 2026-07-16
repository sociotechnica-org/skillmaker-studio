/**
 * A tiny, generic markdown-table reader shared by every module that reads a
 * loosely-specified table back from a file a human hand-edits
 * (`RiskMap.ts`'s `evals/risk-map.md`, `Triage.ts`'s `adopt-manifest.md`,
 * issue #92) -- house pattern: tolerant, warns rather than throws, never
 * assumes a table exists. Extracted (issue #92 simplify pass) because the
 * two modules' original copies were more than "four line-level helpers": a
 * ~20-line collect/validate algorithm (`collectTableLines` below) was being
 * hand-copied verbatim, not just a couple of one-line predicates.
 */

/** A markdown table row: any line that (after trim) starts with `|`. */
export const isTableRow = (line: string): boolean => line.trim().startsWith("|");

/** A markdown table separator row, e.g. `|---|---|---|---|`. */
export const isSeparatorRow = (line: string): boolean => /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(line.trim());

/**
 * Splits `| a | b | c |` into `["a", "b", "c"]`, tolerating a missing
 * leading/trailing pipe. A cell may contain an escaped pipe (`\|` -- e.g.
 * `Triage.ts`'s free-text "Hurts" column) -- split on an unescaped `|` only,
 * then unescape. `RiskMap.ts`'s columns never contain a literal `\|`
 * sequence today, so sharing the escape-tolerant version widens what it
 * accepts without changing what it currently parses.
 */
export const splitTableCells = (line: string): string[] => {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
};

export type CollectTableLinesResult =
  | { readonly kind: "found"; readonly header: string; readonly separator: string; readonly dataLines: ReadonlyArray<string> }
  | { readonly kind: "no-table" }
  | { readonly kind: "invalid-header" };

/**
 * Collects one contiguous block of `|`-prefixed lines out of `lines` and
 * validates it as `header` + separator + data rows. `"no-table"` (no table
 * block found at all -- e.g. the file doesn't have one yet) and
 * `"invalid-header"` (a table block exists but its first two lines aren't a
 * valid header/separator pair) are deliberately distinct outcomes: callers
 * treat a wholly absent table differently from a malformed one
 * (`RiskMap.ts`'s optional `risk-map.md` warns on neither vs the other;
 * `Triage.ts`'s `adopt-manifest.md` warns on both, with different text) --
 * this helper only does the shared collecting/validating, never the
 * wording of what to tell the human.
 */
export const collectTableLines = (lines: ReadonlyArray<string>): CollectTableLinesResult => {
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
    return { kind: "no-table" };
  }

  const [header, separator, ...dataLines] = tableLines;
  if (header === undefined || separator === undefined || !isSeparatorRow(separator)) {
    return { kind: "invalid-header" };
  }

  return { kind: "found", header, separator, dataLines };
};
