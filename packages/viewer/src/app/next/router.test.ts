import { describe, expect, test } from "bun:test";
import { boardHref, parseStudioRoute, skillHref, tasksHref } from "./router.tsx";

describe("next shell routes (#208)", () => {
  test("parses canonical skill places, tabs, and a version lens", () => {
    expect(parseStudioRoute("/p/team/s/review-pr/research", "?v=deadbeef")).toEqual({
      name: "skill", projectSlug: "team", skillSlug: "review-pr", tab: "research", version: "deadbeef",
    });
    expect(parseStudioRoute("/p/team/s/review-pr")).toEqual({
      name: "skill", projectSlug: "team", skillSlug: "review-pr", tab: "overview",
    });
  });

  test("rejects malformed places without allowing a crash from bad encoding", () => {
    expect(parseStudioRoute("/p/%E0%A4%A/s/alpha")).toEqual({ name: "invalid" });
    expect(parseStudioRoute("/p/team/s/alpha/unknown")).toEqual({ name: "invalid" });
    expect(parseStudioRoute("/p/team/s/alpha/extra/path")).toEqual({ name: "invalid" });
  });

  test("href builders encode identity and omit the overview suffix", () => {
    expect(boardHref("a b")).toBe("/p/a%20b");
    expect(tasksHref("team")).toBe("/p/team/tasks");
    expect(skillHref("a/b", "new skill", "overview", "deadbeef")).toBe("/p/a%2Fb/s/new%20skill?v=deadbeef");
  });
});
