/**
 * The outward book's ONE population definition (issue #109 Stage 3):
 * `isInSkillbook` is derived into each bundle's `inBook` by
 * `buildSkillbook`, and BOTH doors -- the static `book build` index
 * (`BookRenderer.ts`) and the viewer's Ship page (which consumes the same
 * payload field) -- inherit it. These tests hold the static side to that:
 * the index lists exactly the `inBook` bundles, works-in-progress are
 * counted not listed, and a chapter page still renders for EVERY bundle
 * (curation shapes the index, it never 404s the paperwork).
 */
import { describe, expect, test } from "bun:test";
import { renderSkillbookSite } from "../src/BookRenderer.ts";
import { isInSkillbook, type SkillbookBundle, type SkillbookData } from "../src/Skillbook.ts";

const bundle = (overrides: Partial<SkillbookBundle> & { slug: string }): SkillbookBundle => {
  const base = {
    name: overrides.slug,
    oneLiner: "",
    stage: "idea",
    designMarkdown: "",
    latestVersion: null,
    measurements: [],
    changelog: [],
    shipments: [],
    ...overrides,
  };
  // `inBook` is stamped from the SAME predicate `buildSkillbook` uses --
  // the fixture mirrors production derivation instead of hand-picking.
  return { ...base, inBook: isInSkillbook(base) };
};

describe("isInSkillbook", () => {
  test("published without shipments is in the book", () => {
    expect(isInSkillbook({ stage: "published", shipments: [] })).toBe(true);
  });

  test("shipped without being published is in the book (shipped facts are receipts too)", () => {
    expect(isInSkillbook({ stage: "drafting", shipments: [{}] })).toBe(true);
  });

  test("neither published nor shipped stays inside (Catalog only)", () => {
    expect(isInSkillbook({ stage: "evaluating", shipments: [] })).toBe(false);
  });
});

describe("renderSkillbookSite honors inBook (the two surfaces share one population)", () => {
  const published = bundle({ slug: "published-skill", stage: "published" });
  const wip = bundle({ slug: "wip-skill", stage: "drafting" });
  const data: SkillbookData = { workspaceName: "Test Studio", bundles: [published, wip] };
  const pages = renderSkillbookSite(data);
  const index = pages.find((page) => page.fileName === "index.html");

  test("the index lists the curated population only, with a works-in-progress count", () => {
    expect(index?.html).toContain("published-skill");
    expect(index?.html).not.toContain('href="wip-skill.html"');
    expect(index?.html).toContain("1 skill(s) in this Skillbook");
    expect(index?.html).toContain("1 more in progress");
  });

  test("a chapter page still renders for every bundle, curated or not", () => {
    expect(pages.map((page) => page.fileName).sort()).toEqual([
      "index.html",
      "published-skill.html",
      "wip-skill.html",
    ]);
  });

  test("an empty workspace keeps its honest empty state", () => {
    const emptyIndex = renderSkillbookSite({ workspaceName: "Empty", bundles: [] }).find(
      (page) => page.fileName === "index.html",
    );
    expect(emptyIndex?.html.toLowerCase()).toContain("no skill");
  });
});
