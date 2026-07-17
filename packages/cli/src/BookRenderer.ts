/**
 * `skillmaker book build`'s static-site renderer (data-model.md §2.14): a
 * hand-rolled markdown->HTML pass (no dependency -- headings/lists/paras/code
 * only, the subset `design.md` actually uses) plus two page templates
 * (index + per-bundle chapter), inline-CSS, matching the viewer's dark
 * neutral/emerald aesthetic. Pure string-in/string-out -- no I/O; `BookBuild.ts`
 * owns writing the result to disk.
 */
import { shortHash, type MeasurementRecord } from "@skillmaker/core";
import type { SkillbookBundle, SkillbookChangelogEntry, SkillbookData } from "./Skillbook.ts";

export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * A minimal markdown->HTML pass: `#`..`######` headings, `-`/`*` bullet
 * lists, fenced ``` code blocks, and paragraphs (blank-line separated). No
 * inline emphasis/links -- `design.md` in this codebase doesn't rely on
 * them, and a hand-rolled inline parser is exactly the kind of scope this
 * module intentionally stays out of.
 */
export const renderMarkdown = (markdown: string): string => {
  const lines = markdown.split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let listItems: string[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = (): void => {
    if (paragraphLines.length > 0) {
      html.push(`<p>${escapeHtml(paragraphLines.join(" "))}</p>`);
      paragraphLines = [];
    }
  };
  const flushList = (): void => {
    if (listItems.length > 0) {
      html.push(`<ul>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
      listItems = [];
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch !== null) {
      flushParagraph();
      flushList();
      const level = headingMatch[1]?.length ?? 1;
      const text = headingMatch[2] ?? "";
      html.push(`<h${level}>${escapeHtml(text)}</h${level}>`);
      continue;
    }

    const listMatch = /^[-*]\s+(.*)$/.exec(line);
    if (listMatch !== null) {
      flushParagraph();
      listItems.push(listMatch[1] ?? "");
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    paragraphLines.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (inCodeBlock && codeLines.length > 0) {
    // An unterminated fence: still render what was captured rather than
    // dropping it silently.
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return html.join("\n");
};

const PAGE_STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #0a0a0a;
    color: #e5e5e5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.55;
  }
  header.site {
    padding: 1.5rem 2rem;
    border-bottom: 1px solid #262626;
  }
  header.site a { color: #e5e5e5; text-decoration: none; font-weight: 600; }
  main { max-width: 860px; margin: 0 auto; padding: 2rem; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; border-top: 1px solid #262626; padding-top: 1.5rem; }
  h3 { font-size: 1rem; color: #a3a3a3; }
  p { color: #d4d4d4; }
  a { color: #34d399; }
  ul { padding-left: 1.25rem; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
  pre { background: #171717; padding: 0.75rem; border-radius: 6px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #262626; }
  th { color: #a3a3a3; font-weight: 500; }
  .badge {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
    background: #052e1e;
    color: #34d399;
  }
  .muted { color: #737373; font-size: 0.85rem; }
  .card {
    border: 1px solid #262626;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 1rem;
  }
  .card h3 a { color: #e5e5e5; }
  .changelog-item { display: flex; gap: 0.75rem; padding: 0.35rem 0; border-bottom: 1px solid #171717; font-size: 0.85rem; }
  .changelog-item .at { color: #737373; white-space: nowrap; }
`;

const pageShell = (title: string, workspaceName: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header class="site"><a href="index.html">${escapeHtml(workspaceName)} — Skillbook</a></header>
<main>
${body}
</main>
</body>
</html>
`;

const bundlePageHref = (slug: string): string => `${slug}.html`;

const formatCi = (ci: MeasurementRecord["ci"]): string =>
  ci === null ? "—" : `[${(ci[0] * 100).toFixed(1)}%, ${(ci[1] * 100).toFixed(1)}%]`;

const measurementsTable = (measurements: ReadonlyArray<MeasurementRecord>): string => {
  if (measurements.length === 0) {
    return `<p class="muted">No measurements recorded yet.</p>`;
  }
  const rows = measurements
    .map(
      (measurement) => `<tr>
        <td>${escapeHtml(measurement.fixtureCase)}</td>
        <td>${escapeHtml(measurement.provider)}/${escapeHtml(measurement.model)}</td>
        <td>${shortHash(measurement.versionHash, 8)}</td>
        <td>${measurement.n}</td>
        <td>${measurement.passes}/${measurement.n}</td>
        <td>${(measurement.passRate * 100).toFixed(1)}%</td>
        <td>${formatCi(measurement.ci)}</td>
      </tr>`,
    )
    .join("\n");
  return `<table>
    <thead><tr><th>Fixture</th><th>Provider/model</th><th>Version</th><th>n</th><th>Pass</th><th>Rate</th><th>95% CI</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
};

const changelogList = (changelog: ReadonlyArray<SkillbookChangelogEntry>): string => {
  if (changelog.length === 0) {
    return `<p class="muted">No journal history yet.</p>`;
  }
  return changelog
    .map(
      (entry) =>
        `<div class="changelog-item"><span class="at">${escapeHtml(new Date(entry.at).toLocaleString())}</span><span>${escapeHtml(entry.summary)}</span></div>`,
    )
    .join("\n");
};

const renderBundlePage = (workspaceName: string, bundle: SkillbookBundle): string => {
  const designHtml =
    bundle.designMarkdown.trim().length === 0
      ? `<p class="muted">No design.md content yet.</p>`
      : renderMarkdown(bundle.designMarkdown);

  const versionLine =
    bundle.latestVersion === null
      ? `<p class="muted">No version recorded yet.</p>`
      : `<p>Latest version: <code>${shortHash(bundle.latestVersion.hash, 12)}</code>${
          bundle.latestVersion.label !== undefined ? ` ("${escapeHtml(bundle.latestVersion.label)}")` : ""
        } — recorded ${escapeHtml(new Date(bundle.latestVersion.recordedAt).toLocaleString())}</p>`;

  const body = `
<p><a href="index.html">&larr; All skills</a></p>
<h1>${escapeHtml(bundle.name)}</h1>
<p class="muted"><span class="badge">${escapeHtml(bundle.stage)}</span> ${escapeHtml(bundle.oneLiner)}</p>

<h2>Design</h2>
${designHtml}

<h2>Receipts</h2>
${versionLine}
${measurementsTable(bundle.measurements)}

<h2>Changelog</h2>
${changelogList(bundle.changelog)}
`;
  return pageShell(bundle.name, workspaceName, body);
};

/**
 * The index lists ONLY the curated population (issue #109 Stage 3): the
 * bundles `buildSkillbook` stamped `inBook` -- the outward book, "what we
 * stand behind; what you may take." Works-in-progress are counted, never
 * listed; their chapter pages still exist (`renderSkillbookSite` renders
 * one per bundle regardless -- curation shapes the index, it never 404s
 * the paperwork). The one predicate lives in `Skillbook.ts`'s
 * `isInSkillbook`, shared with the viewer's Ship page via the payload.
 */
const renderIndexPage = (data: SkillbookData): string => {
  const inBook = data.bundles.filter((bundle) => bundle.inBook);
  const insideCount = data.bundles.length - inBook.length;
  const cards =
    data.bundles.length === 0
      ? `<p class="muted">No Skill Bundles yet.</p>`
      : inBook.length === 0
        ? `<p class="muted">No skills published or shipped yet — the book is honestly empty.</p>`
        : inBook
            .map((bundle) => {
              const measuredCount = new Set(bundle.measurements.map((m) => m.fixtureCase)).size;
              const versionText =
                bundle.latestVersion === null ? "No version" : `Version ${shortHash(bundle.latestVersion.hash, 8)}`;
              return `<div class="card">
  <h3><a href="${bundlePageHref(bundle.slug)}">${escapeHtml(bundle.name)}</a> <span class="badge">${escapeHtml(bundle.stage)}</span></h3>
  <p>${escapeHtml(bundle.oneLiner)}</p>
  <p class="muted">${escapeHtml(versionText)} · ${measuredCount} fixture(s) measured</p>
</div>`;
            })
            .join("\n");

  const insideLine =
    insideCount > 0
      ? `\n<p class="muted">${insideCount} more in progress live in the studio's Catalog — the outward book lists only what published or shipped.</p>`
      : "";

  const body = `
<h1>${escapeHtml(data.workspaceName)}</h1>
<p class="muted">What we stand behind; what you may take — skills leave the studio with receipts. ${inBook.length} skill(s) in this Skillbook.</p>
${cards}${insideLine}
`;
  return pageShell(`${data.workspaceName} — Skillbook`, data.workspaceName, body);
};

export interface RenderedSkillbookPage {
  readonly fileName: string;
  readonly html: string;
}

/** Renders every page of the static Skillbook site: `index.html` + one page per bundle. */
export const renderSkillbookSite = (data: SkillbookData): ReadonlyArray<RenderedSkillbookPage> => [
  { fileName: "index.html", html: renderIndexPage(data) },
  ...data.bundles.map((bundle) => ({ fileName: bundlePageHref(bundle.slug), html: renderBundlePage(data.workspaceName, bundle) })),
];
