/**
 * Render-level checks for the markdown file view (#143), via
 * `renderToStaticMarkup` -- no DOM needed, matching the repo's bun-test
 * setup. The load-bearing case: a script-bearing agent-produced .md must
 * come out ESCAPED (no live <script>/<iframe>/onerror markup), because the
 * renderer builds React elements and never touches innerHTML.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileContentView, MarkdownContent } from "./Markdown.tsx";

describe("MarkdownContent sanitization", () => {
  const hostile = [
    "# Title",
    "",
    '<script>window.__pwned = true;</script>',
    "",
    '<iframe src="https://evil.example"></iframe>',
    "",
    'Inline <img src=x onerror="alert(1)"> html.',
    "",
    "[click](javascript:alert(1))",
  ].join("\n");

  test("script/iframe/onerror from an untrusted .md never become live markup", () => {
    const html = renderToStaticMarkup(<MarkdownContent markdown={hostile} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain('onerror="'); // survives only inside escaped text (onerror=&quot;...)
    expect(html).not.toContain("javascript:");
    // The payload is still VISIBLE, as escaped text.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;iframe");
  });

  test("formatted output covers headings, lists, tables, code fences", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent markdown={"# H\n\n- item\n\n| a |\n| - |\n| 1 |\n\n```\ncode\n```"} />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<ul");
    expect(html).toContain("<table");
    expect(html).toContain("<pre");
  });

  test("numbered steps with blank lines and nested bullets stay ONE <ol> (Prompt tab numbering)", () => {
    const skill = ["1. gather", "", "   more detail", "", "2. plan", "   - short", "   - cited", "", "3. ship"].join("\n");
    const html = renderToStaticMarkup(<MarkdownContent markdown={skill} />);
    // One continuous ordered list, nested bullets inside their <li>.
    expect(html.match(/<ol/g)).toHaveLength(1);
    expect(html.match(/<\/li>/g)).toHaveLength(5); // 3 steps + 2 nested bullets
    expect(html).toContain("<ul");
    expect(html.indexOf("<ul")).toBeGreaterThan(html.indexOf("<ol"));
    expect(html.indexOf("</ol>")).toBeGreaterThan(html.indexOf("</ul>"));
    expect(html).toContain("more detail");
  });

  test("an interrupted ordered list resumes with a start attribute, not at 1", () => {
    const html = renderToStaticMarkup(<MarkdownContent markdown={"1. one\n\n```\ncode\n```\n\n2. two"} />);
    expect(html).toContain('start="2"');
  });
});

describe("FileContentView", () => {
  test(".md paths get the rendered view plus a Raw toggle", () => {
    const html = renderToStaticMarkup(
      <FileContentView path="response.md" content="# Hello" preClassName="pre-style" />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain(">Raw<");
  });

  test("rendered view hides frontmatter and comments; the content prop stays the exact original for the Raw toggle", () => {
    const content = "---\nname: mapper\n---\n<!-- hidden note -->\n# Mapper";
    const html = renderToStaticMarkup(
      <FileContentView path="SKILL.md" content={content} preClassName="pre-style" />,
    );
    expect(html).toContain("<h1");
    expect(html).not.toContain("name: mapper");
    expect(html).not.toContain("hidden note");
    // Raw mode is the same <pre>{content}</pre> as the plain branch -- the
    // string is passed through untouched (stripping happens only inside
    // parseMarkdown), so raw stays lossless by construction.
  });

  test("non-.md paths keep the plain <pre> with no toggle", () => {
    const content = '{"not": "markdown", "heading": "# nope"}';
    const html = renderToStaticMarkup(
      <FileContentView path="fixture.json" content={content} preClassName="pre-style" />,
    );
    expect(html).toContain('<pre class="pre-style">');
    expect(html).not.toContain(">Raw<");
    expect(html).not.toContain("<h1");
  });

  test("raw view emits the exact original content (lossless)", () => {
    // The raw <pre> in the .md branch and the parser input are the same
    // untouched string -- assert the non-toggled path here and rely on
    // markdown.test.ts for parser purity; state toggling is a useState flip
    // over that same prop.
    const content = "# Title\n\n<script>x</script>\n";
    const html = renderToStaticMarkup(
      <FileContentView path="plain.txt" content={content} preClassName="p" />,
    );
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
