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
});

describe("FileContentView", () => {
  test(".md paths get the rendered view plus a Raw toggle", () => {
    const html = renderToStaticMarkup(
      <FileContentView path="response.md" content="# Hello" preClassName="pre-style" />,
    );
    expect(html).toContain("<h1");
    expect(html).toContain(">Raw<");
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
