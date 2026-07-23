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
            { slug: "to-tickets", stage: "evaluating", oneLiner: "Decompose scope into tickets" },
            { slug: "release-notes", stage: "idea", oneLiner: "Draft release notes" },
            { slug: "book-builder", stage: "researching", oneLiner: "" },
            { slug: "pr-writer", stage: "drafting", oneLiner: "Write PR descriptions" },
            { slug: "shipper", stage: "published", oneLiner: "Ship it" },
          ],
        },
      ],
    });
    expect(decoded).toEqual([
      {
        name: "skillmaker-studio",
        path: "~/Documents/code/skillmaker-studio",
        skills: [
          { slug: "to-tickets", stage: "Evals", oneLiner: "Decompose scope into tickets" },
          { slug: "release-notes", stage: "Idea", oneLiner: "Draft release notes" },
          { slug: "book-builder", stage: "Research", oneLiner: "" },
          { slug: "pr-writer", stage: "Drafting", oneLiner: "Write PR descriptions" },
          { slug: "shipper", stage: "Published", oneLiner: "Ship it" },
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
    expect(decoded).toEqual([{ name: "ok", path: "/ok", skills: [{ slug: "good", stage: "Idea", oneLiner: "g" }] }]);
  });

  test("returns null (keep the placeholder) for non-conforming payloads", () => {
    expect(decodeProjectsResponse(null)).toBeNull();
    expect(decodeProjectsResponse("nope")).toBeNull();
    expect(decodeProjectsResponse({})).toBeNull();
    expect(decodeProjectsResponse({ projects: "not-an-array" })).toBeNull();
  });

  test("tolerates a missing skills array (a project with no skills yet)", () => {
    expect(decodeProjectsResponse({ projects: [{ name: "bare", path: "/bare" }] })).toEqual([
      { name: "bare", path: "/bare", skills: [] },
    ]);
  });
});
