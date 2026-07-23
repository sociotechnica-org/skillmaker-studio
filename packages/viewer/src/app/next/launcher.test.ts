import { describe, expect, test } from "bun:test";
import { decodeCandidatesResponse, deriveSlug, slugBaseFromMessage, uniquifySlug } from "./launcher.ts";

describe("slugBaseFromMessage", () => {
  test("keeps 3-5 meaningful words, dropping stopwords", () => {
    expect(slugBaseFromMessage("I want a skill that turns incident channels into postmortem docs")).toBe(
      "turns-incident-channels-postmortem-docs",
    );
  });

  test("caps at five meaningful words", () => {
    expect(slugBaseFromMessage("summarize weekly engineering standup notes across many repos quickly")).toBe(
      "summarize-weekly-engineering-standup-notes",
    );
  });

  test("backfills from raw words when fewer than three meaningful ones exist", () => {
    // "make", "a", "skill" are stopwords; "changelog" is the only
    // meaningful word -- raw words backfill in original order.
    expect(slugBaseFromMessage("make a changelog skill")).toBe("make-a-changelog");
  });

  test("strips punctuation and case", () => {
    expect(slugBaseFromMessage("Draft RELEASE notes, please! (from merged PRs)")).toBe(
      "draft-release-notes-merged-prs",
    );
  });

  test("an unusable message falls back to new-skill", () => {
    expect(slugBaseFromMessage("")).toBe("new-skill");
    expect(slugBaseFromMessage("!!! ???")).toBe("new-skill");
  });
});

describe("uniquifySlug", () => {
  test("returns the base untouched when free", () => {
    expect(uniquifySlug("release-notes", new Set())).toBe("release-notes");
  });

  test("suffixes -2, -3, ... on collision", () => {
    expect(uniquifySlug("release-notes", new Set(["release-notes"]))).toBe("release-notes-2");
    expect(uniquifySlug("release-notes", new Set(["release-notes", "release-notes-2"]))).toBe("release-notes-3");
  });
});

describe("deriveSlug", () => {
  test("derives and uniquifies in one step", () => {
    const taken = new Set(["draft-release-notes-merged-prs"]);
    expect(deriveSlug("Draft release notes from merged PRs", taken)).toBe("draft-release-notes-merged-prs-2");
  });
});

describe("decodeCandidatesResponse", () => {
  test("decodes rows, tolerating a missing slug", () => {
    expect(
      decodeCandidatesResponse({
        candidates: [
          { path: "imported/release-notes/SKILL.md", slug: "release-notes" },
          { path: "docs/how-to/SKILL.md" },
        ],
      }),
    ).toEqual([
      { path: "imported/release-notes/SKILL.md", slug: "release-notes" },
      { path: "docs/how-to/SKILL.md", slug: undefined },
    ]);
  });

  test("drops malformed rows instead of failing the payload", () => {
    expect(
      decodeCandidatesResponse({ candidates: [{ path: "" }, { slug: "no-path" }, null, "nope", { path: "ok/SKILL.md" }] }),
    ).toEqual([{ path: "ok/SKILL.md", slug: undefined }]);
  });

  test("returns null for non-conforming payloads", () => {
    expect(decodeCandidatesResponse(null)).toBeNull();
    expect(decodeCandidatesResponse({})).toBeNull();
    expect(decodeCandidatesResponse({ candidates: "nope" })).toBeNull();
  });
});
