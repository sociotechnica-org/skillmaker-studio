import { describe, expect, test } from "bun:test";
import { decodeProjectsResponse } from "./projectsApi.ts";

describe("decodeProjectsResponse", () => {
  test("decodes the server's one-workspace payload, mapping server stages to display labels", () => {
    const decoded = decodeProjectsResponse({
      projects: [
        {
          name: "skillmaker-studio",
          path: "~/Documents/code/skillmaker-studio",
          skills: [
            { slug: "to-tickets", stage: "evaluating", substate: "awaiting-review", oneLiner: "Decompose scope into tickets" },
            { slug: "release-notes", stage: "idea", substate: "working", oneLiner: "Draft release notes" },
            { slug: "book-builder", stage: "researching", oneLiner: "" },
            { slug: "pr-writer", stage: "drafting", oneLiner: "Write PR descriptions" },
            { slug: "shipper", stage: "published", oneLiner: "Ship it" },
          ],
        },
      ],
    });
    expect(decoded).toEqual([
      {
        // No slug on the wire (pre-registry payload): falls back to the
        // name; absent `ok` reads healthy.
        slug: "skillmaker-studio",
        ok: true,
        name: "skillmaker-studio",
        path: "~/Documents/code/skillmaker-studio",
        skills: [
          // Only an explicit awaiting-review earns the attention dot; a
          // missing substate (older server) decodes as false, never invented.
          { slug: "to-tickets", stage: "Evals", oneLiner: "Decompose scope into tickets", awaitingReview: true },
          { slug: "release-notes", stage: "Idea", oneLiner: "Draft release notes", awaitingReview: false },
          { slug: "book-builder", stage: "Research", oneLiner: "", awaitingReview: false },
          { slug: "pr-writer", stage: "Drafting", oneLiner: "Write PR descriptions", awaitingReview: false },
          { slug: "shipper", stage: "Published", oneLiner: "Ship it", awaitingReview: false },
        ],
      },
    ]);
  });

  test("the array shape holds for multiple projects (the later registry needs no client change)", () => {
    const decoded = decodeProjectsResponse({
      projects: [
        { name: "a", path: "~/a", skills: [] },
        { name: "b", path: "~/b", skills: [{ slug: "s", stage: "idea", oneLiner: "x" }] },
      ],
    });
    expect(decoded?.map((p) => p.name)).toEqual(["a", "b"]);
  });

  test("passes through already-display-shaped stages and floors unknown vocabulary at Idea", () => {
    const decoded = decodeProjectsResponse({
      projects: [
        {
          name: "w",
          path: "/w",
          skills: [
            { slug: "display", stage: "Evals", oneLiner: "" },
            { slug: "future", stage: "incubating", oneLiner: "" },
          ],
        },
      ],
    });
    expect(decoded?.[0]?.skills.map((s) => s.stage)).toEqual(["Evals", "Idea"]);
  });

  test("drops malformed skills and projects instead of failing the whole payload", () => {
    const decoded = decodeProjectsResponse({
      projects: [
        { name: "ok", path: "/ok", skills: [{ slug: "good", stage: "idea", oneLiner: "g" }, { stage: "idea" }, null] },
        { path: "/nameless", skills: [] },
        "not-a-project",
      ],
    });
    expect(decoded).toEqual([
      { slug: "ok", ok: true, name: "ok", path: "/ok", skills: [{ slug: "good", stage: "Idea", oneLiner: "g", awaitingReview: false }] },
    ]);
  });

  test("decodes the machine-registry payload: slug is the identifier, broken rows keep ok:false + error", () => {
    const decoded = decodeProjectsResponse({
      projects: [
        { slug: "alpha", name: "Alpha", path: "~/a", ok: true, skills: [] },
        { slug: "ghost-abc123", name: "ghost", path: "~/g", ok: false, error: "directory does not exist", skills: [] },
      ],
    });
    expect(decoded?.map((p) => [p.slug, p.ok])).toEqual([
      ["alpha", true],
      ["ghost-abc123", false],
    ]);
    expect(decoded?.[1]?.error).toBe("directory does not exist");
  });

  test("returns null (keep the placeholder) for non-conforming payloads", () => {
    expect(decodeProjectsResponse(null)).toBeNull();
    expect(decodeProjectsResponse("nope")).toBeNull();
    expect(decodeProjectsResponse({})).toBeNull();
    expect(decodeProjectsResponse({ projects: "not-an-array" })).toBeNull();
  });

  test("tolerates a missing skills array (a project with no skills yet)", () => {
    expect(decodeProjectsResponse({ projects: [{ name: "bare", path: "/bare" }] })).toEqual([
      { slug: "bare", ok: true, name: "bare", path: "/bare", skills: [] },
    ]);
  });
});
