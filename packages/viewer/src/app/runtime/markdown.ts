/**
 * Markdown -> block AST for the viewer's file displays (#143).
 *
 * The repo's existing markdown pathway is a hand-rolled subset rendered as
 * React elements (`Ship.tsx`'s `renderMarkdown`, mirroring the CLI's
 * `BookRenderer.ts`). This module extends that same approach -- a pure
 * parser producing structured blocks, no HTML string assembly anywhere --
 * so it stays safe BY CONSTRUCTION: agent-produced `.md` files are
 * untrusted input, and because raw HTML in the source is only ever emitted
 * as literal text nodes (there is no "html" node kind at all), `<script>`
 * and `<iframe>` payloads can never execute. Rendering to React happens in
 * `components/Markdown.tsx`.
 *
 * Supported subset: ATX headings, paragraphs, unordered/ordered lists,
 * fenced code, pipe tables, blockquotes; inline code/strong/emphasis/links
 * (links only with an allowlisted scheme -- everything else stays text).
 */

export type InlineNode =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "strong"; readonly children: ReadonlyArray<InlineNode> }
  | { readonly kind: "em"; readonly children: ReadonlyArray<InlineNode> }
  | { readonly kind: "link"; readonly href: string; readonly children: ReadonlyArray<InlineNode> };

export type MarkdownBlock =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly children: ReadonlyArray<InlineNode> }
  | { readonly kind: "paragraph"; readonly children: ReadonlyArray<InlineNode> }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: ReadonlyArray<ReadonlyArray<InlineNode>> }
  | { readonly kind: "code"; readonly text: string; readonly lang: string | undefined }
  | {
      readonly kind: "table";
      readonly header: ReadonlyArray<ReadonlyArray<InlineNode>>;
      readonly rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<InlineNode>>>;
    }
  | { readonly kind: "blockquote"; readonly children: ReadonlyArray<InlineNode> };

/** The file displays render markdown only for these extensions. */
export const isMarkdownPath = (path: string): boolean => /\.(md|markdown)$/i.test(path);

/**
 * Link hrefs from untrusted markdown: allow http(s), mailto, fragments and
 * relative paths; reject everything with any other scheme (`javascript:`,
 * `data:`, `vbscript:`, ...). Returns `undefined` for rejected hrefs -- the
 * renderer then keeps the link text as plain text.
 */
export const safeHref = (href: string): string | undefined => {
  const trimmed = href.trim();
  if (trimmed.length === 0) return undefined;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (schemeMatch === null) return trimmed; // relative path or #fragment
  const scheme = (schemeMatch[1] ?? "").toLowerCase();
  return scheme === "http" || scheme === "https" || scheme === "mailto" ? trimmed : undefined;
};

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const findUnescaped = (text: string, marker: string, from: number): number => {
  let at = text.indexOf(marker, from);
  while (at > 0 && text[at - 1] === "\\") {
    at = text.indexOf(marker, at + 1);
  }
  return at;
};

/** Parse inline markdown (code spans, **strong**, *em*, [links](url)) into nodes. */
export const parseInline = (text: string): ReadonlyArray<InlineNode> => {
  const nodes: Array<InlineNode> = [];
  let plain = "";
  const flushPlain = (): void => {
    if (plain.length > 0) {
      nodes.push({ kind: "text", text: plain });
      plain = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";

    if (ch === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        flushPlain();
        nodes.push({ kind: "code", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    if (ch === "[") {
      // [label](target) -- label may not contain brackets; target allows one
      // level of balanced parens (e.g. `javascript:alert(1)` must be consumed
      // whole so its tail never leaks as text), plus an optional ignored "title".
      const match = /^\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\)/.exec(text.slice(i));
      if (match !== null) {
        const label = match[1] ?? "";
        const target = match[2] ?? "";
        const href = safeHref(target);
        flushPlain();
        if (href !== undefined) {
          nodes.push({ kind: "link", href, children: parseInline(label) });
        } else {
          // Unsafe scheme: the label survives as text, the target is dropped.
          nodes.push({ kind: "text", text: label });
        }
        i += match[0].length;
        continue;
      }
    }

    if (text.startsWith("**", i)) {
      const close = findUnescaped(text, "**", i + 2);
      if (close !== -1 && close > i + 2) {
        flushPlain();
        nodes.push({ kind: "strong", children: parseInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (ch === "*") {
      const close = findUnescaped(text, "*", i + 1);
      if (close !== -1 && close > i + 1) {
        flushPlain();
        nodes.push({ kind: "em", children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    plain += ch;
    i += 1;
  }
  flushPlain();
  return nodes;
};

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const splitTableRow = (line: string): ReadonlyArray<string> => {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((cell) => cell.trim());
};

/** Parse a full markdown document into blocks. Never throws; unknown syntax degrades to paragraphs. */
export const parseMarkdown = (markdown: string): ReadonlyArray<MarkdownBlock> => {
  const lines = markdown.split("\n");
  const blocks: Array<MarkdownBlock> = [];

  let inCode = false;
  let codeLang: string | undefined = undefined;
  let codeLines: Array<string> = [];
  let listItems: Array<ReadonlyArray<InlineNode>> = [];
  let listOrdered = false;
  let paragraphLines: Array<string> = [];
  let quoteLines: Array<string> = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length > 0) {
      blocks.push({ kind: "paragraph", children: parseInline(paragraphLines.join(" ")) });
      paragraphLines = [];
    }
  };
  const flushList = (): void => {
    if (listItems.length > 0) {
      blocks.push({ kind: "list", ordered: listOrdered, items: listItems });
      listItems = [];
    }
  };
  const flushQuote = (): void => {
    if (quoteLines.length > 0) {
      blocks.push({ kind: "blockquote", children: parseInline(quoteLines.join(" ")) });
      quoteLines = [];
    }
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? "";

    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ kind: "code", text: codeLines.join("\n"), lang: codeLang });
        codeLines = [];
        codeLang = undefined;
        inCode = false;
      } else {
        flushAll();
        const lang = line.trim().slice(3).trim();
        codeLang = lang.length > 0 ? lang : undefined;
        inCode = true;
      }
      lineIndex += 1;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      lineIndex += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch !== null) {
      flushAll();
      const level = Math.min(6, Math.max(1, (headingMatch[1] ?? "#").length)) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, children: parseInline(headingMatch[2] ?? "") });
      lineIndex += 1;
      continue;
    }

    // Pipe table: a `|`-leading row whose NEXT line is a dash separator.
    if (line.trim().startsWith("|") && TABLE_SEPARATOR.test((lines[lineIndex + 1] ?? "").trim())) {
      flushAll();
      const header = splitTableRow(line).map(parseInline);
      const rows: Array<ReadonlyArray<ReadonlyArray<InlineNode>>> = [];
      let rowIndex = lineIndex + 2;
      while (rowIndex < lines.length && (lines[rowIndex] ?? "").trim().startsWith("|")) {
        rows.push(splitTableRow(lines[rowIndex] ?? "").map(parseInline));
        rowIndex += 1;
      }
      blocks.push({ kind: "table", header, rows });
      lineIndex = rowIndex;
      continue;
    }

    const quoteMatch = /^>\s?(.*)$/.exec(line.trim());
    if (quoteMatch !== null) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1] ?? "");
      lineIndex += 1;
      continue;
    }

    const unorderedMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    const orderedMatch = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (unorderedMatch !== null || orderedMatch !== null) {
      flushParagraph();
      flushQuote();
      const ordered = unorderedMatch === null;
      if (listItems.length > 0 && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listItems.push(parseInline((unorderedMatch?.[1] ?? orderedMatch?.[1]) ?? ""));
      lineIndex += 1;
      continue;
    }

    if (line.trim().length === 0) {
      flushAll();
      lineIndex += 1;
      continue;
    }

    flushList();
    flushQuote();
    paragraphLines.push(line.trim());
    lineIndex += 1;
  }

  if (inCode) {
    // Unclosed fence: keep what was captured rather than dropping it.
    blocks.push({ kind: "code", text: codeLines.join("\n"), lang: codeLang });
  }
  flushAll();

  return blocks;
};
