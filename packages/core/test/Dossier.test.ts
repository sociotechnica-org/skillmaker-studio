import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { parseDossier, writeDossierScaffold } from "../src/Dossier.ts";
import { withTempDir } from "./support/TestLayer.ts";

const writeDossier = (dir: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;
    yield* fs.writeFileString(path.join(dir, "dossier.md"), content);
    return path.join(dir, "dossier.md");
  });

describe("parseDossier", () => {
  test("missing file -> every section a gap, no warning (optional until authored)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        const result = yield* parseDossier(path.join(dir, "dossier.md"));
        expect(result.sections).toEqual({ contexts: [] });
        expect(result.warnings).toEqual([]);
        expect(result.unknownSections).toEqual([]);
      }),
    );
  });

  test("happy path: every known section parses", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const dossierPath = yield* writeDossier(
          dir,
          `---
bundle: frame-the-problem
---
# Dossier — Frame The Problem

## Job
Turns a vague ask into a structured problem statement.

## Contexts

### PR review comment
Handoff-in: a diff.
Downstream reads: only the comment body.
Environment: single-turn, no tools, no human gate.
Stakes: load-bearing

### Slack DM
Handoff-in: a pasted message thread.
Stakes: aside

## Out-of-scope
Not for open-ended brainstorming with no artifact to react to.

## Basis
Volere requirements process -- ask Dana.

## Evidence
None yet; no permission requested.

## Fit criterion
Given a vague ask, produces a one-paragraph problem statement a stranger could act on.
`,
        );

        const result = yield* parseDossier(dossierPath);
        expect(result.warnings).toEqual([]);
        expect(result.unknownSections).toEqual([]);
        expect(result.sections.job).toBe("Turns a vague ask into a structured problem statement.");
        expect(result.sections.outOfScope).toBe(
          "Not for open-ended brainstorming with no artifact to react to.",
        );
        expect(result.sections.basis).toBe("Volere requirements process -- ask Dana.");
        expect(result.sections.evidence).toBe("None yet; no permission requested.");
        expect(result.sections.fitCriterion).toBe(
          "Given a vague ask, produces a one-paragraph problem statement a stranger could act on.",
        );
        expect(result.sections.contexts).toEqual([
          {
            name: "PR review comment",
            body: "Handoff-in: a diff.\nDownstream reads: only the comment body.\nEnvironment: single-turn, no tools, no human gate.\nStakes: load-bearing",
          },
          { name: "Slack DM", body: "Handoff-in: a pasted message thread.\nStakes: aside" },
        ]);
      }),
    );
  });

  test("a section holding only its scaffold comment reads as an honest gap, not content", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const dossierPath = yield* writeDossier(
          dir,
          `## Job
<!-- One line: what does this skill do? -->

## Fit criterion
<!-- If you had to write one pass/fail test today, what would it check? -->
`,
        );

        const result = yield* parseDossier(dossierPath);
        expect(result.sections.job).toBeUndefined();
        expect(result.sections.fitCriterion).toBeUndefined();
        expect(result.warnings).toEqual([]);
      }),
    );
  });

  test("a heading this scanner doesn't recognize is preserved, not dropped", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const dossierPath = yield* writeDossier(
          dir,
          `## Job
Does the thing.

## Whose idea was this
Dana's, originally.
`,
        );

        const result = yield* parseDossier(dossierPath);
        expect(result.sections.job).toBe("Does the thing.");
        expect(result.unknownSections).toEqual([{ heading: "Whose idea was this", body: "Dana's, originally." }]);
        expect(result.warnings).toEqual([]);
      }),
    );
  });

  test("Contexts content with no named heading -> warning, zero contexts recorded", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const dossierPath = yield* writeDossier(
          dir,
          `## Contexts
Just runs in one place, nothing fancy.
`,
        );

        const result = yield* parseDossier(dossierPath);
        expect(result.sections.contexts).toEqual([]);
        expect(result.warnings.some((w) => w.includes("no named context"))).toBe(true);
      }),
    );
  });

  test("Contexts section absent entirely -> empty array, no warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const dossierPath = yield* writeDossier(dir, `## Job\nDoes the thing.\n`);
        const result = yield* parseDossier(dossierPath);
        expect(result.sections.contexts).toEqual([]);
        expect(result.warnings).toEqual([]);
      }),
    );
  });
});

describe("writeDossierScaffold", () => {
  test("writes comment-hinted empty sections that scan back as every field an honest gap", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        const fs = yield* FileSystem;

        yield* writeDossierScaffold(dir, "frame-the-problem", "Frame The Problem");

        const content = yield* fs.readFileString(path.join(dir, "dossier.md"));
        expect(content).toContain("bundle: frame-the-problem");
        expect(content).toContain("# Dossier — Frame The Problem");
        expect(content).toContain("## Contexts");

        const result = yield* parseDossier(path.join(dir, "dossier.md"));
        expect(result.warnings).toEqual([]);
        expect(result.unknownSections).toEqual([]);
        expect(result.sections).toEqual({ contexts: [] });
      }),
    );
  });

  test("never clobbers an existing dossier.md (files are canonical for content)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        const fs = yield* FileSystem;
        yield* fs.writeFileString(path.join(dir, "dossier.md"), "## Job\nAlready hand-authored.\n");

        yield* writeDossierScaffold(dir, "frame-the-problem", "Frame The Problem");

        const content = yield* fs.readFileString(path.join(dir, "dossier.md"));
        expect(content).toBe("## Job\nAlready hand-authored.\n");
      }),
    );
  });
});
