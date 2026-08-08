import { describe, expect, test } from "bun:test";
import { boardHref, canonicalStudioHref, parseStudioRoute, skillHref, tasksHref, versionPin } from "./router.tsx";

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

  test("accepts exactly one lowercase eight-character version lens and rejects malformed or duplicate pins", () => {
    expect(parseStudioRoute("/p/team/s/alpha", "?v=deadbeef")).toMatchObject({ name: "skill", version: "deadbeef" });
    expect(parseStudioRoute("/p/team/s/alpha", "?v=sha256%3Adeadbeef")).toEqual({ name: "invalid" });
    expect(parseStudioRoute("/p/team/s/alpha", "?v=DEADBEEF")).toEqual({ name: "invalid" });
    expect(parseStudioRoute("/p/team/s/alpha", "?v=deadbeef&v=cafebabe")).toEqual({ name: "invalid" });
  });

  test("href builders encode identity and omit the overview suffix", () => {
    expect(boardHref("a b")).toBe("/p/a%20b");
    expect(tasksHref("team")).toBe("/p/team/tasks");
    expect(skillHref("a/b", "new skill", "overview", "deadbeef")).toBe("/p/a%2Fb/s/new%20skill?v=deadbeef");
    expect(versionPin(`sha256:${"a".repeat(64)}`)).toBe("aaaaaaaa");
    expect(skillHref("team", "alpha", "eval", `sha256:${"b".repeat(64)}`)).toBe("/p/team/s/alpha/eval?v=bbbbbbbb");
  });

  test("canonical hrefs reconcile redundant path/query spelling without changing route identity", () => {
    const route = parseStudioRoute("//p//team//s//alpha//eval/", "?v=deadbeef&unused=1");
    expect(route).toEqual({ name: "skill", projectSlug: "team", skillSlug: "alpha", tab: "eval", version: "deadbeef" });
    expect(canonicalStudioHref(route)).toBe("/p/team/s/alpha/eval?v=deadbeef");
  });
});
