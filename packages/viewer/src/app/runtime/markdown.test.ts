import { describe, expect, test } from "bun:test";
import { isMarkdownPath, parseInline, parseMarkdown, safeHref, stripHiddenMarkdown, type InlineNode } from "./markdown.ts";

const textOf = (nodes: ReadonlyArray<InlineNode>): string =>
  nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "code":
          return node.text;
        case "strong":
        case "em":
        case "link":
          return textOf(node.children);
      }
    })
    .join("");

describe("isMarkdownPath", () => {
  test("matches .md and .markdown, case-insensitively", () => {
    expect(isMarkdownPath("response.md")).toBe(true);
    expect(isMarkdownPath("output/SKILL.md")).toBe(true);
    expect(isMarkdownPath("notes.MD")).toBe(true);
    expect(isMarkdownPath("doc.markdown")).toBe(true);
  });

  test("rejects everything else, including md-ish names", () => {
    expect(isMarkdownPath("fixture.json")).toBe(false);
    expect(isMarkdownPath("script.ts")).toBe(false);
    expect(isMarkdownPath("md")).toBe(false);
    expect(isMarkdownPath("readme.md.bak")).toBe(false);
  });
});

describe("safeHref", () => {
  test("allows http, https, mailto, relative, fragment", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://example.com")).toBe("http://example.com");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("./sibling.md")).toBe("./sibling.md");
    expect(safeHref("#section")).toBe("#section");
  });

  test("rejects javascript:, data:, vbscript:, and case variants", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("JavaScript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeHref("  javascript:alert(1)")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});

describe("parseMarkdown blocks", () => {
  test("headings at each level", () => {
    const blocks = parseMarkdown("# One\n\n### Three\n\n###### Six");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(blocks[1]).toMatchObject({ kind: "heading", level: 3 });
    expect(blocks[2]).toMatchObject({ kind: "heading", level: 6 });
  });

  test("paragraphs join wrapped lines and split on blanks", () => {
    const blocks = parseMarkdown("line one\nline two\n\nsecond para");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe("paragraph");
    expect(textOf((blocks[0] as { children: ReadonlyArray<InlineNode> }).children)).toBe("line one line two");
  });

  test("unordered and ordered lists, kept separate", () => {
    const blocks = parseMarkdown("- a\n- b\n1. first\n2. second");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
    expect((blocks[0] as { items: ReadonlyArray<unknown> }).items).toHaveLength(2);
  });

  test("fenced code keeps content verbatim, records language", () => {
    const blocks = parseMarkdown("```ts\nconst x = 1;\n# not a heading\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "code", lang: "ts", text: "const x = 1;\n# not a heading" });
  });

  test("unclosed fence keeps captured lines instead of dropping them", () => {
    const blocks = parseMarkdown("```\ntrapped");
    expect(blocks).toEqual([{ kind: "code", text: "trapped", lang: undefined }]);
  });

  test("pipe tables parse header and rows", () => {
    const blocks = parseMarkdown("| a | b |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |");
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as { kind: string; header: ReadonlyArray<ReadonlyArray<InlineNode>>; rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<InlineNode>>> };
    expect(table.kind).toBe("table");
    expect(table.header.map(textOf)).toEqual(["a", "b"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.map(textOf)).toEqual(["1", "2"]);
  });

  test("a pipe line without a separator stays a paragraph", () => {
    const blocks = parseMarkdown("| just | text |");
    expect(blocks[0]?.kind).toBe("paragraph");
  });

  test("blockquotes", () => {
    const blocks = parseMarkdown("> quoted line\n> continues");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("blockquote");
    expect(textOf((blocks[0] as { children: ReadonlyArray<InlineNode> }).children)).toBe("quoted line continues");
  });
});

describe("parseInline", () => {
  test("code spans, strong, em, links", () => {
    const nodes = parseInline("run `bun test` with **force** and *care*, see [docs](https://example.com)");
    const kinds = nodes.map((n) => n.kind);
    expect(kinds).toContain("code");
    expect(kinds).toContain("strong");
    expect(kinds).toContain("em");
    expect(kinds).toContain("link");
    const link = nodes.find((n) => n.kind === "link");
    expect(link).toMatchObject({ href: "https://example.com" });
  });

  test("javascript: links are stripped to their label text", () => {
    const nodes = parseInline("click [here](javascript:alert(1)) now");
    expect(nodes.some((n) => n.kind === "link")).toBe(false);
    expect(textOf(nodes)).toBe("click here now");
  });
});

describe("sanitization by construction (untrusted agent-produced .md)", () => {
  const hostile = [
    "# Title",
    "",
    '<script>window.__pwned = true;</script>',
    "",
    '<iframe src="https://evil.example"></iframe>',
    "",
    'Normal text with inline <img src=x onerror="alert(1)"> html.',
  ].join("\n");

  test("raw HTML only ever becomes literal text nodes -- there is no html node kind", () => {
    const blocks = parseMarkdown(hostile);
    const inlineKinds = new Set<string>();
    const collect = (nodes: ReadonlyArray<InlineNode>): void => {
      for (const node of nodes) {
        inlineKinds.add(node.kind);
        if (node.kind === "strong" || node.kind === "em" || node.kind === "link") collect(node.children);
      }
    };
    for (const block of blocks) {
      expect(["heading", "paragraph", "list", "code", "table", "blockquote"]).toContain(block.kind);
      if (block.kind === "heading" || block.kind === "paragraph" || block.kind === "blockquote") collect(block.children);
    }
    // Every inline node is one of the five safe kinds; the <script> payload
    // survives only as text content, never as markup.
    for (const kind of inlineKinds) {
      expect(["text", "code", "strong", "em", "link"]).toContain(kind);
    }
    const allText = blocks
      .filter((b): b is Extract<typeof b, { children: ReadonlyArray<InlineNode> }> => "children" in b)
      .map((b) => textOf(b.children))
      .join("\n");
    expect(allText).toContain("<script>window.__pwned = true;</script>");
    expect(allText).toContain('<iframe src="https://evil.example"></iframe>');
  });
});

describe("hidden metadata in RENDERED views (frontmatter + HTML comments)", () => {
  const skillMd = [
    "---",
    "name: risk-mapper",
    "description: Maps risks.",
    "allowed-tools: Read, Grep",
    "---",
    "",
    "<!-- internal: do not surface this note -->",
    "",
    "# Risk Mapper",
    "",
    "Use this skill to map risks.",
  ].join("\n");

  test("leading YAML frontmatter never reaches rendered blocks", () => {
    const blocks = parseMarkdown(skillMd);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    const allText = JSON.stringify(blocks);
    expect(allText).not.toContain("allowed-tools");
    expect(allText).not.toContain("risk-mapper");
  });

  test("HTML comments are stripped, including multi-line ones", () => {
    const blocks = parseMarkdown("before <!-- one --> after\n\n<!-- spans\nseveral\nlines -->\n\ntail");
    expect(blocks).toHaveLength(2);
    expect(textOf((blocks[0] as { children: ReadonlyArray<InlineNode> }).children)).toBe("before  after");
    expect(textOf((blocks[1] as { children: ReadonlyArray<InlineNode> }).children)).toBe("tail");
  });

  test("a whole-line comment vanishes without splitting the surrounding paragraph", () => {
    const blocks = parseMarkdown("first line\n<!-- hidden -->\nsecond line");
    expect(blocks).toHaveLength(1);
    expect(textOf((blocks[0] as { children: ReadonlyArray<InlineNode> }).children)).toBe("first line second line");
  });

  test("`---` past the top of the document is NOT treated as frontmatter", () => {
    const blocks = parseMarkdown("intro paragraph\n\n---\n\nafter the break");
    const allText = JSON.stringify(blocks);
    expect(allText).toContain("intro paragraph");
    expect(allText).toContain("after the break");
    // The mid-document delimiter pair must not swallow what sits between them.
    const between = parseMarkdown("# Top\n\n---\nnot: frontmatter\n---\n\nend");
    expect(JSON.stringify(between)).toContain("not: frontmatter");
  });

  test("an UNCLOSED leading `---` renders as-is rather than eating the document", () => {
    const source = "---\ntitle: dangling\n\nbody text";
    expect(stripHiddenMarkdown(source)).toBe(source);
    expect(JSON.stringify(parseMarkdown(source))).toContain("title: dangling");
  });

  test("comments inside fenced code blocks survive (they are code, not metadata)", () => {
    const blocks = parseMarkdown("```html\n<!-- keep me -->\n```");
    expect(blocks).toEqual([{ kind: "code", text: "<!-- keep me -->", lang: "html" }]);
  });

  test("an unclosed comment hides the remainder, matching HTML semantics", () => {
    const blocks = parseMarkdown("visible\n\n<!-- never closed\nswallowed");
    expect(blocks).toHaveLength(1);
    expect(textOf((blocks[0] as { children: ReadonlyArray<InlineNode> }).children)).toBe("visible");
  });

  test("stripHiddenMarkdown is a pure pre-pass: plain documents come through byte-identical", () => {
    const plain = "# Title\n\nA paragraph with `code` and a | pipe.\n\n- item\n";
    expect(stripHiddenMarkdown(plain)).toBe(plain);
  });
});
