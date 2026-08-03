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
  NEXT_STEP_BY_STAGE,
  PREAMBLE_SENTINEL,
  PREAMBLE_SEPARATOR,
  readPreambleContext,
  type PreambleStage,
} from "../src/server/ChatSessions.ts";

const STAGES: ReadonlyArray<PreambleStage> = ["idea", "researching", "drafting", "evaluating", "published"];

describe("buildChatPreamble", () => {
  const context = { oneLiner: "turn READMEs into onboarding docs", stage: "idea" as const };

  test("carries the director's template facts: studio, mission, one-liner, slug, stage", () => {
    const preamble = buildChatPreamble("readme-onboarding", "skills", context);
    expect(preamble).toStartWith(PREAMBLE_SENTINEL);
    expect(preamble).toContain("create a reusable SKILL");
    expect(preamble).toContain("turn READMEs into onboarding docs");
    expect(preamble).toContain("(slug: readme-onboarding)");
    expect(preamble).toContain("ship its SKILL.md");
    expect(preamble).toContain("at stage idea");
  });

  test("points at the agent-home William guidance and the skillmaker CLI, and states direct-edit reality", () => {
    const preamble = buildChatPreamble("readme-onboarding", "skills", context);
    expect(preamble).toContain("william-");
    expect(preamble).toContain("agent home");
    expect(preamble).toContain("skillmaker");
    expect(preamble).toContain("DIRECTLY in the project");
    // The bundle path uses the workspace's configured skillsDir.
    expect(preamble).toContain("skills/readme-onboarding/");
  });

  test("encodes the real pipeline, including design.md co-authored in conversation", () => {
    const preamble = buildChatPreamble("readme-onboarding", "skills", context);
    expect(preamble).toContain("design.md (co-authored in this conversation)");
    expect(preamble).toContain("human-gated");
  });

  test("every stage maps to its ruled next step, closed by the do-the-step instruction", () => {
    for (const stage of STAGES) {
      const preamble = buildChatPreamble("s", "skills", { oneLiner: "x", stage });
      expect(preamble).toContain(`The current step is: ${NEXT_STEP_BY_STAGE[stage]}.`);
      expect(preamble).toContain("Do the STEP, not the skill's task itself.");
    }
    expect(NEXT_STEP_BY_STAGE.idea).toBe("clarify intent and research");
    expect(NEXT_STEP_BY_STAGE.researching).toBe("research, then surface open questions");
    expect(NEXT_STEP_BY_STAGE.drafting).toBe("draft from design.md");
    expect(NEXT_STEP_BY_STAGE.evaluating).toBe("author/run evals");
    expect(NEXT_STEP_BY_STAGE.published).toBe("maintain and improve");
  });

  test("an empty one-liner drops the clause instead of rendering an empty dash", () => {
    const preamble = buildChatPreamble("s", "skills", { oneLiner: "  ", stage: "idea" });
    expect(preamble).toContain("create a reusable SKILL as a skillmaker bundle");
    expect(preamble).not.toContain("-- --");
  });
});

describe("buildChatReorientation", () => {
  test("one line: slug, stage, current step, do-the-step", () => {
    const line = buildChatReorientation("readme-onboarding", { oneLiner: "", stage: "drafting" });
    expect(line).toStartWith("Re-orientation:");
    expect(line).toContain('"readme-onboarding"');
    expect(line).toContain("stage: drafting");
    expect(line).toContain(NEXT_STEP_BY_STAGE.drafting);
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
      expect(readPreambleContext(root, "skills", "my-skill")).toEqual({
        oneLiner: "does the thing",
        stage: "drafting",
      });
    });
  });

  test("degrades honestly: no bundle.json, no journal -> empty one-liner, stage idea", () => {
    withScratch((root) => {
      expect(readPreambleContext(root, "skills", "ghost")).toEqual({ oneLiner: "", stage: "idea" });
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
      expect(readPreambleContext(root, "skills", "s").stage).toBe("evaluating");
    });
  });
});

describe("wire composition constants", () => {
  test("the separator isolates the user's words from the machine context (the viewer splits on it)", () => {
    expect(PREAMBLE_SEPARATOR).toBe("\n\n---\n\n");
    const preamble = buildChatPreamble("s", "skills", { oneLiner: "", stage: "idea" });
    // The preamble itself must never contain the separator, or the
    // viewer's split lands mid-context.
    expect(preamble).not.toContain(PREAMBLE_SEPARATOR);
  });
});
