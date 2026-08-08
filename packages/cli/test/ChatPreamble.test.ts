/**
 * The chat first-prompt preamble (e2e-readiness Blocker #5): minute-zero
 * production context for launcher/panel-started sessions, parameterized
 * from the bundle (slug, one-liner, stage, stage-appropriate next step),
 * plus the tolerant bundle-context reader and the resumed-session
 * re-orientation variant.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChatPreamble,
  buildChatReorientation,
  deriveArtifactStage,
  NEXT_STEP_BY_STAGE,
  ORIENTATION_INSTRUCTION,
  PREAMBLE_SENTINEL,
  PREAMBLE_SEPARATOR,
  readPreambleContext,
  type PreambleStage,
} from "../src/server/ChatSessions.ts";

const STAGES: ReadonlyArray<PreambleStage> = ["idea", "researching", "drafting", "evaluating", "published"];

describe("buildChatPreamble", () => {
  const context = {
    oneLiner: "turn READMEs into onboarding docs",
    stage: "idea" as const,
    derivedStage: "idea" as const,
    installedHelpers: ["william-research-a-skill", "william-draft-skill-md"],
  };

  test("carries the director's template facts: studio, mission, one-liner, slug", () => {
    const preamble = buildChatPreamble("readme-onboarding", "skills", context);
    expect(preamble).toStartWith(PREAMBLE_SENTINEL);
    expect(preamble).toContain("create a reusable SKILL");
    expect(preamble).toContain("turn READMEs into onboarding docs");
    expect(preamble).toContain("(slug: readme-onboarding)");
    expect(preamble).toContain("ship its SKILL.md");
  });

  test("names the installed guidance helpers, the skillmaker CLI, and direct-edit reality", () => {
    const preamble = buildChatPreamble("readme-onboarding", "skills", context);
    expect(preamble).toContain(
      "Your guidance skills (william-research-a-skill, william-draft-skill-md) are installed in your agent home",
    );
    expect(preamble).toContain("agent home");
    expect(preamble).toContain("skillmaker");
    expect(preamble).toContain("DIRECTLY in the project");
    // The bundle path uses the workspace's configured skillsDir.
    expect(preamble).toContain("skills/readme-onboarding/");
  });

  test("omits the guidance line when no helpers installed", () => {
    const preamble = buildChatPreamble("readme-onboarding", "skills", { ...context, installedHelpers: [] });
    expect(preamble).not.toContain("guidance skills");
    expect(preamble).not.toContain("agent home");
    expect(preamble).not.toContain("william-");
  });

  test("names only the helper that installed", () => {
    const preamble = buildChatPreamble("readme-onboarding", "skills", {
      ...context,
      installedHelpers: ["william-draft-skill-md"],
    });
    expect(preamble).toContain("Your guidance skills (william-draft-skill-md) are installed");
    expect(preamble).not.toContain("william-research-a-skill");
  });

  test("leaves every non-helper line and blank-line boundary unchanged", () => {
    const expected = [
      "You're inside Skillmaker Studio. Your job is to help me create a reusable SKILL -- turn READMEs into onboarding docs -- as a skillmaker bundle (slug: readme-onboarding) that will eventually ship its SKILL.md.",
      "",
      "- The bundle lives at skills/readme-onboarding/ -- design.md (the design doc), output/SKILL.md (the shipped skill text), evals/ (risk map + fixtures), research/ (notes).",
      `- The pipeline: RESEARCHING covers both research/notes.md and co-authoring design.md in this conversation (the stage ends when the design is done); DRAFTING renders output/SKILL.md from the approved design; then evals; then publish. Stage moves happen only at explicit human gates via the skillmaker CLI -- "design" is not a stage, so never attempt or offer a stage transition for it.`,
      "- Studio state -- todos, fixtures, runs, stages -- is read and changed through the `skillmaker` CLI (run `skillmaker --help` to see commands). Prefer the CLI over editing .skillmaker/ files by hand.",
      "- You are working DIRECTLY in the project; edits are real, not sandboxed.",
      "",
      `The current step is: ${NEXT_STEP_BY_STAGE.idea}. That's read from the artifacts that actually exist in the bundle (the declared stage is "idea" -- stages move at human gates and may lag the artifacts). Do the STEP, not the skill's task itself.`,
    ].join("\n");
    const withoutGuidanceLine = (preamble: string): string =>
      preamble
        .split("\n")
        .filter((line) => !line.startsWith("- Your guidance skills "))
        .join("\n");

    const present = buildChatPreamble("readme-onboarding", "skills", context);
    const absent = buildChatPreamble("readme-onboarding", "skills", { ...context, installedHelpers: [] });
    const partial = buildChatPreamble("readme-onboarding", "skills", {
      ...context,
      installedHelpers: ["william-draft-skill-md"],
    });
    expect(withoutGuidanceLine(present)).toBe(expected);
    expect(absent).toBe(expected);
    expect(withoutGuidanceLine(partial)).toBe(expected);
  });

  test("encodes the real pipeline, including design.md co-authored in conversation", () => {
    const preamble = buildChatPreamble("readme-onboarding", "skills", context);
    expect(preamble).toContain("design.md (co-authored in this conversation)");
    expect(preamble).toContain("human-gated");
  });

  test("the current step is phrased from the DERIVED stage; the declared stage is secondary honesty", () => {
    for (const derivedStage of STAGES) {
      const preamble = buildChatPreamble("s", "skills", { oneLiner: "x", stage: "idea", derivedStage, installedHelpers: [] });
      expect(preamble).toContain(`The current step is: ${NEXT_STEP_BY_STAGE[derivedStage]}.`);
      expect(preamble).toContain("Do the STEP, not the skill's task itself.");
    }
    expect(NEXT_STEP_BY_STAGE.idea).toBe("clarify intent and research");
    expect(NEXT_STEP_BY_STAGE.researching).toBe("research into notes.md, surface open questions one at a time, then co-author design.md -- researching ends when the design is done");
    expect(NEXT_STEP_BY_STAGE.drafting).toBe("draft from design.md");
    expect(NEXT_STEP_BY_STAGE.evaluating).toBe("author/run evals");
    expect(NEXT_STEP_BY_STAGE.published).toBe("maintain and improve");
  });

  test("never asserts the declared stage as truth: it appears only in the may-lag honesty clause", () => {
    // The live-tested lie: journal says "idea", artifacts say everything exists.
    const preamble = buildChatPreamble("s", "skills", {
      oneLiner: "x",
      stage: "idea",
      derivedStage: "published",
      installedHelpers: [],
    });
    expect(preamble).not.toContain("at stage idea");
    expect(preamble).toContain(`The current step is: ${NEXT_STEP_BY_STAGE.published}.`);
    expect(preamble).toContain('the declared stage is "idea"');
    expect(preamble).toContain("may lag the artifacts");
    expect(preamble).toContain("human gates");
  });

  test("an empty one-liner drops the clause instead of rendering an empty dash", () => {
    const preamble = buildChatPreamble("s", "skills", {
      oneLiner: "  ",
      stage: "idea",
      derivedStage: "idea",
      installedHelpers: [],
    });
    expect(preamble).toContain("create a reusable SKILL as a skillmaker bundle");
    expect(preamble).not.toContain("-- --");
  });
});

describe("buildChatReorientation", () => {
  test("one line: slug, artifact-derived current step, declared stage as honesty, do-the-step", () => {
    const line = buildChatReorientation("readme-onboarding", {
      oneLiner: "",
      stage: "researching",
      derivedStage: "drafting",
      installedHelpers: [],
    });
    expect(line).toStartWith("Re-orientation:");
    expect(line).toContain('"readme-onboarding"');
    expect(line).toContain(`current step, from the artifacts: ${NEXT_STEP_BY_STAGE.drafting}`);
    expect(line).toContain("declared stage: researching");
    expect(line).toContain("Do the STEP");
    expect(line).not.toContain("\n");
  });
});

describe("readPreambleContext", () => {
  const withScratch = (run: (root: string) => void): void => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-preamble-test-"));
    try {
      run(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test("reads the one-liner from bundle.json and the stage from the journal's last stage_changed", () => {
    withScratch((root) => {
      mkdirSync(join(root, "skills", "my-skill"), { recursive: true });
      writeFileSync(
        join(root, "skills", "my-skill", "bundle.json"),
        `${JSON.stringify({ schemaVersion: 1, slug: "my-skill", name: "My Skill", oneLiner: "does the thing" })}\n`,
      );
      mkdirSync(join(root, ".skillmaker"), { recursive: true });
      const events = [
        { type: "bundle.created", payload: { bundle: "my-skill" } },
        { type: "bundle.stage_changed", payload: { bundle: "my-skill", from: "idea", to: "researching" } },
        { type: "bundle.stage_changed", payload: { bundle: "other", from: "idea", to: "published" } },
        { type: "bundle.stage_changed", payload: { bundle: "my-skill", from: "researching", to: "drafting" } },
      ];
      writeFileSync(
        join(root, ".skillmaker", "events.jsonl"),
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      );
      expect(readPreambleContext(root, "skills", "my-skill", ["installed-helper"])).toEqual({
        oneLiner: "does the thing",
        stage: "drafting",
        derivedStage: "idea",
        installedHelpers: ["installed-helper"],
      });
    });
  });

  test("degrades honestly: no bundle.json, no journal, no artifacts -> empty one-liner, everything idea", () => {
    withScratch((root) => {
      expect(readPreambleContext(root, "skills", "ghost", [])).toEqual({
        oneLiner: "",
        stage: "idea",
        derivedStage: "idea",
        installedHelpers: [],
      });
    });
  });

  test("probes the artifacts too: a bundle whose journal never moved still derives its real position", () => {
    withScratch((root) => {
      const bundleDir = join(root, "skills", "my-skill");
      mkdirSync(join(bundleDir, "research"), { recursive: true });
      writeFileSync(join(bundleDir, "research", "notes.md"), "# Notes\n\nFindings.\n");
      // No journal at all: declared stage degrades to idea, derived stage does not.
      expect(readPreambleContext(root, "skills", "my-skill", [])).toEqual({
        oneLiner: "",
        stage: "idea",
        derivedStage: "researching",
        installedHelpers: [],
      });
    });
  });

  test("tolerates malformed journal lines and unknown stages without throwing", () => {
    withScratch((root) => {
      mkdirSync(join(root, ".skillmaker"), { recursive: true });
      writeFileSync(
        join(root, ".skillmaker", "events.jsonl"),
        [
          "not json at all",
          JSON.stringify({ type: "bundle.stage_changed", payload: { bundle: "s", to: "warp-speed" } }),
          JSON.stringify({ type: "bundle.stage_changed", payload: { bundle: "s", to: "evaluating" } }),
          "",
        ].join("\n"),
      );
      expect(readPreambleContext(root, "skills", "s", []).stage).toBe("evaluating");
    });
  });
});

describe("deriveArtifactStage (the current step comes from what exists, not what's declared)", () => {
  const withBundle = (run: (bundleDir: string) => void): void => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-derive-test-"));
    try {
      const bundleDir = join(root, "skills", "s");
      mkdirSync(bundleDir, { recursive: true });
      run(bundleDir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  // The skeleton `skillmaker new` writes: frontmatter, title, section
  // headings, comment hints -- and NO prose (WorkspaceService.ts).
  const scaffoldDesign = [
    "---",
    "bundle: s",
    "---",
    "# Design — S",
    "",
    "## Intent",
    "<!-- What outcome this skill produces and for whom. -->",
    "",
    "## Failure hypotheses",
    "<!-- | # | How it could fail | Risk family | -->",
    "",
  ].join("\n");

  test("an empty bundle is at idea", () => {
    withBundle((bundleDir) => {
      expect(deriveArtifactStage(bundleDir)).toBe("idea");
    });
  });

  test("research/notes.md alone -> researching; a scaffold-only design.md does not advance it", () => {
    withBundle((bundleDir) => {
      mkdirSync(join(bundleDir, "research"), { recursive: true });
      writeFileSync(join(bundleDir, "research", "notes.md"), "# Notes\n\nFindings.\n");
      expect(deriveArtifactStage(bundleDir)).toBe("researching");
      writeFileSync(join(bundleDir, "design.md"), scaffoldDesign);
      expect(deriveArtifactStage(bundleDir)).toBe("researching");
    });
  });

  test("design.md with real prose under a heading -> researching (ruling 2026-08-08: design is researching's second movement)", () => {
    withBundle((bundleDir) => {
      writeFileSync(
        join(bundleDir, "design.md"),
        `${scaffoldDesign.replace(
          "<!-- What outcome this skill produces and for whom. -->",
          "Turns a repo's README into an onboarding doc.",
        )}`,
      );
      expect(deriveArtifactStage(bundleDir)).toBe("researching");
    });
  });

  test("output/SKILL.md -> evaluating; a fixture case -> published (the furthest artifact wins)", () => {
    withBundle((bundleDir) => {
      mkdirSync(join(bundleDir, "output"), { recursive: true });
      writeFileSync(join(bundleDir, "output", "SKILL.md"), "---\nname: s\n---\nDo the thing.\n");
      expect(deriveArtifactStage(bundleDir)).toBe("evaluating");
      mkdirSync(join(bundleDir, "evals", "fixtures", "trigger-basic"), { recursive: true });
      expect(deriveArtifactStage(bundleDir)).toBe("published");
    });
  });

  test("an empty or dotfile-only fixtures dir does not count as evals", () => {
    withBundle((bundleDir) => {
      mkdirSync(join(bundleDir, "evals", "fixtures"), { recursive: true });
      writeFileSync(join(bundleDir, "evals", "fixtures", ".gitkeep"), "");
      expect(deriveArtifactStage(bundleDir)).toBe("idea");
    });
  });

  test("the live-tested lie end to end: everything exists, journal still says idea -> step reads maintain-and-improve, stage disclosed as declared-only", () => {
    withBundle((bundleDir) => {
      mkdirSync(join(bundleDir, "research"), { recursive: true });
      writeFileSync(join(bundleDir, "research", "notes.md"), "notes\n");
      writeFileSync(join(bundleDir, "design.md"), "Real design prose.\n");
      mkdirSync(join(bundleDir, "output"), { recursive: true });
      writeFileSync(join(bundleDir, "output", "SKILL.md"), "skill\n");
      mkdirSync(join(bundleDir, "evals", "fixtures", "case-1"), { recursive: true });
      const root = join(bundleDir, "..", "..");
      const context = readPreambleContext(root, "skills", "s", []);
      expect(context.stage).toBe("idea");
      expect(context.derivedStage).toBe("published");
      const preamble = buildChatPreamble("s", "skills", context);
      expect(preamble).toContain("The current step is: maintain and improve.");
      expect(preamble).toContain('the declared stage is "idea"');
    });
  });
});

describe("ORIENTATION_INSTRUCTION (agent speaks first)", () => {
  test("asks for a state check, a stand-up summary, and ONE forward question -- briefly", () => {
    expect(ORIENTATION_INSTRUCTION).toContain("Orient the director");
    expect(ORIENTATION_INSTRUCTION).toContain("skillmaker CLI");
    expect(ORIENTATION_INSTRUCTION).toContain("where things stand");
    expect(ORIENTATION_INSTRUCTION).toContain("one question");
    expect(ORIENTATION_INSTRUCTION).toContain("Keep it short");
  });

  test("never contains the separator (the whole opening prompt must read as machine context)", () => {
    expect(ORIENTATION_INSTRUCTION).not.toContain(PREAMBLE_SEPARATOR);
  });
});

describe("wire composition constants", () => {
  test("the separator isolates the user's words from the machine context (the viewer splits on it)", () => {
    expect(PREAMBLE_SEPARATOR).toBe("\n\n---\n\n");
    const preamble = buildChatPreamble("s", "skills", {
      oneLiner: "",
      stage: "idea",
      derivedStage: "idea",
      installedHelpers: [],
    });
    // The preamble itself must never contain the separator, or the
    // viewer's split lands mid-context.
    expect(preamble).not.toContain(PREAMBLE_SEPARATOR);
  });
});
