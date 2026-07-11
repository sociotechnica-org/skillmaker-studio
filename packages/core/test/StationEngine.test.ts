import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Station } from "../src/Stations.ts";
import {
  _internal,
  buildReviewQuestion,
  buildStationPrompt,
  latestReviseNotes,
} from "../src/StationEngine.ts";

const { filterToProduces, matchesProduces, snapshotFiles, diffFileSnapshots, seedProducesPath } = _internal;

const withTempDir = <A>(fn: (dir: string) => A): A => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-stationengine-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("matchesProduces / filterToProduces (produces-copyback path filtering)", () => {
  test("an exact file entry matches only that exact path", () => {
    expect(matchesProduces("design.md", ["design.md"])).toBe(true);
    expect(matchesProduces("design.md.bak", ["design.md"])).toBe(false);
  });

  test("a directory entry (trailing slash) matches the directory itself and everything under it", () => {
    expect(matchesProduces("research/", ["research/"])).toBe(true);
    expect(matchesProduces("research/notes.md", ["research/"])).toBe(true);
    expect(matchesProduces("research/nested/deep.md", ["research/"])).toBe(true);
    expect(matchesProduces("researching-notes.md", ["research/"])).toBe(false);
  });

  test("filterToProduces keeps only paths under the station's produces list", () => {
    const changed = ["design.md", "output/SKILL.md", "research/notes.md", "evals/fixtures/x/case.json"];
    expect(filterToProduces(changed, ["design.md", "output/SKILL.md"])).toEqual([
      "design.md",
      "output/SKILL.md",
    ]);
  });

  test("filterToProduces drops everything when produces is empty", () => {
    expect(filterToProduces(["a.md", "b.md"], [])).toEqual([]);
  });
});

describe("snapshotFiles / diffFileSnapshots", () => {
  test("skips .git and .claude (the installed-skill dir), same rationale as RunEngine's snapshotTree", () => {
    withTempDir((dir) => {
      mkdirSync(join(dir, ".git"), { recursive: true });
      writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main");
      mkdirSync(join(dir, ".claude", "skills", "some-skill"), { recursive: true });
      writeFileSync(join(dir, ".claude", "skills", "some-skill", "SKILL.md"), "installed skill");
      writeFileSync(join(dir, "design.md"), "real content");

      const snapshot = snapshotFiles(dir);
      expect(snapshot.has(".git/HEAD")).toBe(false);
      expect(snapshot.has(".claude/skills/some-skill/SKILL.md")).toBe(false);
      expect(snapshot.has("design.md")).toBe(true);
      expect(snapshot.size).toBe(1);
    });
  });

  test("diffFileSnapshots reports new and changed-content files", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "design.md"), "v1");
      const before = snapshotFiles(dir);

      writeFileSync(join(dir, "design.md"), "v2");
      mkdirSync(join(dir, "output"), { recursive: true });
      writeFileSync(join(dir, "output", "SKILL.md"), "new skill content");
      const after = snapshotFiles(dir);

      expect(diffFileSnapshots(before, after)).toEqual(["design.md", "output/SKILL.md"]);
    });
  });
});

describe("seedProducesPath", () => {
  test("copies a plain file entry when the source exists", () => {
    withTempDir((srcRoot) => {
      withTempDir((destRoot) => {
        writeFileSync(join(srcRoot, "design.md"), "hello design");
        seedProducesPath(srcRoot, destRoot, "design.md");
        expect(snapshotFiles(destRoot).get("design.md")?.toString()).toBe("hello design");
      });
    });
  });

  test("copies a directory entry (trailing slash) recursively", () => {
    withTempDir((srcRoot) => {
      withTempDir((destRoot) => {
        mkdirSync(join(srcRoot, "research"), { recursive: true });
        writeFileSync(join(srcRoot, "research", "notes.md"), "notes");
        seedProducesPath(srcRoot, destRoot, "research/");
        expect(snapshotFiles(destRoot).get("research/notes.md")?.toString()).toBe("notes");
      });
    });
  });

  test("tolerates a missing source path (the agent may be creating it fresh)", () => {
    withTempDir((srcRoot) => {
      withTempDir((destRoot) => {
        expect(() => seedProducesPath(srcRoot, destRoot, "output/SKILL.md")).not.toThrow();
        expect(snapshotFiles(destRoot).size).toBe(0);
      });
    });
  });
});

const actor = { kind: "user" as const, name: "test-user" };

const station = Station.make({
  doer: "agent",
  skill: "william-draft-skill-md",
  produces: ["design.md", "output/SKILL.md"],
  review: true,
});

describe("buildStationPrompt (prompt assembly)", () => {
  test("includes the state, the station's produces, and the design.md content", () => {
    const prompt = buildStationPrompt({
      bundle: "example-skill",
      state: "drafting",
      station,
      designMd: "# Design\n\nSome real content.",
      reviseNotes: undefined,
    });
    expect(prompt).toContain('"drafting" production station');
    expect(prompt).toContain("example-skill");
    expect(prompt).toContain("design.md, output/SKILL.md");
    expect(prompt).toContain("Some real content.");
    expect(prompt).not.toContain("REVISE NOTES");
  });

  test("includes revise notes when present -- the review-pair loop's carry-forward", () => {
    const prompt = buildStationPrompt({
      bundle: "example-skill",
      state: "drafting",
      station,
      designMd: "# Design",
      reviseNotes: "The description is too vague, name the exact trigger phrase.",
    });
    expect(prompt).toContain("REVISE NOTES: The description is too vague, name the exact trigger phrase.");
  });

  test("omits the design.md section entirely when there is no design.md yet", () => {
    const prompt = buildStationPrompt({
      bundle: "example-skill",
      state: "drafting",
      station,
      designMd: undefined,
      reviseNotes: undefined,
    });
    expect(prompt).not.toContain("design.md (source of the skill's logic)");
  });
});

describe("buildReviewQuestion", () => {
  test("names the changed paths", () => {
    expect(buildReviewQuestion("drafting", ["design.md", "output/SKILL.md"])).toBe(
      'Review the "drafting" station\'s changes to design.md, output/SKILL.md.',
    );
  });

  test("says so plainly when nothing changed", () => {
    expect(buildReviewQuestion("drafting", [])).toBe('Review the "drafting" station\'s run -- no files changed.');
  });
});

describe("latestReviseNotes", () => {
  test("returns undefined when there is no review.resolved for this bundle/state", () => {
    expect(latestReviseNotes([], "example-skill", "drafting")).toBeUndefined();
  });

  test("returns the notes when the latest review.resolved for this state is a revise", () => {
    const events = [
      {
        type: "review.resolved",
        payload: { bundle: "example-skill", state: "drafting", decision: "revise", notes: "fix the frontmatter" },
      },
    ];
    expect(latestReviseNotes(events, "example-skill", "drafting")).toBe("fix the frontmatter");
  });

  test("returns undefined when the latest review.resolved for this state is an approve", () => {
    const events = [
      {
        type: "review.resolved",
        payload: { bundle: "example-skill", state: "drafting", decision: "revise", notes: "fix the frontmatter" },
      },
      {
        type: "review.resolved",
        payload: { bundle: "example-skill", state: "drafting", decision: "approve" },
      },
    ];
    expect(latestReviseNotes(events, "example-skill", "drafting")).toBeUndefined();
  });

  test("ignores review.resolved events for a different bundle or state", () => {
    const events = [
      {
        type: "review.resolved",
        payload: { bundle: "other-skill", state: "drafting", decision: "revise", notes: "irrelevant" },
      },
      {
        type: "review.resolved",
        payload: { bundle: "example-skill", state: "researching", decision: "revise", notes: "also irrelevant" },
      },
    ];
    expect(latestReviseNotes(events, "example-skill", "drafting")).toBeUndefined();
  });

  test("only the LATEST review.resolved for the exact (bundle, state) pair wins", () => {
    const events = [
      {
        type: "review.resolved",
        payload: { bundle: "example-skill", state: "drafting", decision: "revise", notes: "first round" },
      },
      {
        type: "station.started",
        payload: { bundle: "example-skill", state: "drafting" },
      },
      {
        type: "review.resolved",
        payload: { bundle: "example-skill", state: "drafting", decision: "revise", notes: "second round" },
      },
    ];
    expect(latestReviseNotes(events, "example-skill", "drafting")).toBe("second round");
  });
});

void actor;
