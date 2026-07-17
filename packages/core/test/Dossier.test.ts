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

describe("parseDossier: handoff claims on a context (issue #108)", () => {
  /** The wire format's serialize side (issue #108: labeled lines inside the `### <context>` block, as the skeleton's Contexts hint documents) -- the test's own copy so the round-trip below is parse(serialize(x)). */
  const serializeContext = (context: {
    readonly name: string;
    readonly body: string;
    readonly upstream?: string;
    readonly downstream?: string;
    readonly hands?: string;
  }): string =>
    [
      `### ${context.name}`,
      ...(context.upstream !== undefined ? [`Upstream: ${context.upstream}`] : []),
      ...(context.downstream !== undefined ? [`Downstream: ${context.downstream}`] : []),
      ...(context.hands !== undefined ? [`Hands: ${context.hands}`] : []),
      ...(context.body.length > 0 ? [context.body] : []),
    ].join("\n");

  test("round trip: parse(serialize(x)) preserves upstream/downstream/hands and the prose body", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const context = {
          name: "PR review chain",
          body: "Handoff-in: a diff.\nEnvironment: single-turn.",
          upstream: "frame-the-problem",
          downstream: "the release manager's own checklist (not local)",
          hands: "william-the-agent",
        };
        const dossierPath = yield* writeDossier(dir, `## Contexts\n\n${serializeContext(context)}\n`);
        const result = yield* parseDossier(dossierPath);
        expect(result.warnings).toEqual([]);
        expect(result.sections.contexts).toEqual([context]);
      }),
    );
  });

  test("absent claims stay undefined -- honest gaps, never empty strings", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const context = { name: "Slack DM", body: "Just a paste target." };
        const dossierPath = yield* writeDossier(dir, `## Contexts\n\n${serializeContext(context)}\n`);
        const result = yield* parseDossier(dossierPath);
        expect(result.sections.contexts).toEqual([context]);
        expect(result.sections.contexts[0]?.upstream).toBeUndefined();
        expect(result.sections.contexts[0]?.downstream).toBeUndefined();
        expect(result.sections.contexts[0]?.hands).toBeUndefined();
      }),
    );
  });

  test("labels match case-insensitively, in any order, anywhere in the block; non-matching lines stay in body", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const dossierPath = yield* writeDossier(
          dir,
          `## Contexts

### Batch run
Some prose first.
hands: cron
UPSTREAM: nightly-export
Downstream reads: only the summary line.
`,
        );
        const result = yield* parseDossier(dossierPath);
        expect(result.sections.contexts).toEqual([
          {
            name: "Batch run",
            // "Downstream reads:" is prose (a different label), not a claim.
            body: "Some prose first.\nDownstream reads: only the summary line.",
            hands: "cron",
            upstream: "nightly-export",
          },
        ]);
      }),
    );
  });

  test("an old dossier with no labeled lines parses exactly as before -- every claim an honest gap", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const dossierPath = yield* writeDossier(
          dir,
          `## Contexts

### PR review comment
Handoff-in: a diff.
Downstream reads: only the comment body.
Stakes: load-bearing
`,
        );
        const result = yield* parseDossier(dossierPath);
        expect(result.sections.contexts).toEqual([
          {
            name: "PR review comment",
            body: "Handoff-in: a diff.\nDownstream reads: only the comment body.\nStakes: load-bearing",
          },
        ]);
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

  test("a seed fills Job/Out-of-scope/Basis in the fresh scaffold; unseeded sections stay honest gaps (issue #108)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;

        yield* writeDossierScaffold(dir, "browse", "Browse", {
          job: "Browses the web for a given query",
          basis: "Dana's crawling checklist",
        });

        const result = yield* parseDossier(path.join(dir, "dossier.md"));
        expect(result.warnings).toEqual([]);
        expect(result.sections.job).toBe("Browses the web for a given query");
        expect(result.sections.basis).toBe("Dana's crawling checklist");
        expect(result.sections.outOfScope).toBeUndefined();
        expect(result.sections.evidence).toBeUndefined();
        expect(result.sections.fitCriterion).toBeUndefined();
        expect(result.sections.contexts).toEqual([]);
      }),
    );
  });

  test("a blank-string seed value is not-asked, not an answer", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        yield* writeDossierScaffold(dir, "browse", "Browse", { job: "   " });
        const result = yield* parseDossier(path.join(dir, "dossier.md"));
        expect(result.sections.job).toBeUndefined();
      }),
    );
  });

  test("a seed never clobbers an existing dossier.md either", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        const fs = yield* FileSystem;
        yield* fs.writeFileString(path.join(dir, "dossier.md"), "## Job\nAlready hand-authored.\n");

        yield* writeDossierScaffold(dir, "browse", "Browse", { job: "the manifest's late answer" });

        const content = yield* fs.readFileString(path.join(dir, "dossier.md"));
        expect(content).toBe("## Job\nAlready hand-authored.\n");
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
