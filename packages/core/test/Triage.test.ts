import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { layer as JournalLayer } from "../src/JournalService.ts";
import { parseDossier } from "../src/Dossier.ts";
import { isUnverified } from "../src/Verification.ts";
import {
  deriveEntryStage,
  executeManifest,
  parseManifest,
  renderManifest,
  triageWorkspace,
  TRIAGE_ENTRY_STAGE_REASON,
  type MechanicalCondition,
  type TriageRow,
} from "../src/Triage.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

const write = (dir: string, relativePath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const full = join(dir, relativePath);
    yield* fs.makeDirectory(join(full, ".."), { recursive: true });
    yield* fs.writeFileString(full, content);
  });

const skillMd = (name: string, description = "does the thing"): string =>
  `---
name: ${name}
description: ${description}
---
# ${name}

Body content.
`;

const fullCondition: MechanicalCondition = { parses: true, complete: true, hasEvals: true };
const bareCondition: MechanicalCondition = { parses: false, complete: false, hasEvals: false };

const baseRow = (overrides: Partial<TriageRow> = {}): TriageRow => ({
  name: "Some Skill",
  path: "some-skill",
  mechanicalCondition: fullCondition,
  evidence: { kind: "bare" },
  decision: "keep",
  whose: "mine",
  ...overrides,
});

describe("renderManifest / parseManifest: round trip", () => {
  test("a row with every optional field populated survives the round trip", () => {
    const row = baseRow({
      name: "Frame the Problem",
      path: "skills/engineering/frame-the-problem",
      mechanicalCondition: fullCondition,
      evidence: { kind: "hash-match", bundle: "frame-the-problem" },
      decision: "keep",
      whose: "outside",
      rights: "licensed",
      stakes: "load-bearing",
      hurts: "fails on empty input | needs a retry",
      priority: 7,
      job: "Turns a vague ask into a structured problem statement",
      outOfScope: "Not for open-ended brainstorming",
      basis: "Volere requirements process -- ask Dana",
    });

    const rendered = renderManifest([row]);
    const { rows, warnings } = parseManifest(rendered);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(row);
  });

  test("a bare row with every optional field blank survives the round trip at its deferral defaults", () => {
    const row = baseRow({
      mechanicalCondition: bareCondition,
      evidence: { kind: "bare" },
      decision: "keep",
      whose: "mine",
    });

    const rendered = renderManifest([row]);
    const { rows, warnings } = parseManifest(rendered);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(row);
    expect(rows[0]?.rights).toBeUndefined();
    expect(rows[0]?.stakes).toBeUndefined();
    expect(rows[0]?.hurts).toBeUndefined();
    expect(rows[0]?.priority).toBeUndefined();
    expect(rows[0]?.job).toBeUndefined();
    expect(rows[0]?.outOfScope).toBeUndefined();
    expect(rows[0]?.basis).toBeUndefined();
  });

  test("name-collision and foreign-marker evidence round-trip", () => {
    const rows = [
      baseRow({ path: "a", evidence: { kind: "name-collision", bundle: "existing-bundle" } }),
      baseRow({ path: "b", evidence: { kind: "foreign-marker" } }),
    ];
    const { rows: parsed, warnings } = parseManifest(renderManifest(rows));
    expect(warnings).toEqual([]);
    expect(parsed[0]?.evidence).toEqual({ kind: "name-collision", bundle: "existing-bundle" });
    expect(parsed[1]?.evidence).toEqual({ kind: "foreign-marker" });
  });

  test("multiple rows all round-trip independently", () => {
    const rows = [
      baseRow({ path: "one", decision: "archive" }),
      baseRow({ path: "two", decision: "skip" }),
      baseRow({ path: "three", whose: "came-back", stakes: "aside" }),
    ];
    const { rows: parsed } = parseManifest(renderManifest(rows));
    expect(parsed.map((r) => r.path)).toEqual(["one", "two", "three"]);
    expect(parsed[0]?.decision).toBe("archive");
    expect(parsed[1]?.decision).toBe("skip");
    expect(parsed[2]?.whose).toBe("came-back");
    expect(parsed[2]?.stakes).toBe("aside");
  });
});

describe("parseManifest: deferral defaults, never a false fact", () => {
  const HEADER =
    "| Name | Path | Mechanical Condition | Registry Evidence | Decision | Whose | Rights | Stakes | Hurts | Priority | Job | Out-of-scope | Basis |";
  const SEPARATOR = `|${HEADER.split("|").slice(1, -1).map(() => " --- ").join("|")}|`;

  const manifestWithRow = (cells: ReadonlyArray<string>): string =>
    ["# Adopt Triage Manifest", "", HEADER, SEPARATOR, `| ${cells.join(" | ")} |`, ""].join("\n");

  const blankRow = (overrides: Partial<Record<number, string>> = {}): string[] => {
    const cells = ["x", "some/path", "bare", "bare", "keep", "mine", "", "", "", "", "", "", ""];
    for (const [index, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        cells[Number(index)] = value;
      }
    }
    return cells;
  };

  test("blank Decision defaults to keep", () => {
    const { rows, warnings } = parseManifest(manifestWithRow(blankRow({ 4: "" })));
    expect(rows[0]?.decision).toBe("keep");
    expect(warnings).toEqual([]);
  });

  test("blank Whose defaults to unknown -- a recorded answer, never silently mine", () => {
    const { rows } = parseManifest(manifestWithRow(blankRow({ 5: "" })));
    expect(rows[0]?.whose).toBe("unknown");
  });

  test("an unrecognized Decision defaults to keep and warns, rather than silently dropping the row", () => {
    const { rows, warnings } = parseManifest(manifestWithRow(blankRow({ 4: "discard" })));
    expect(rows[0]?.decision).toBe("keep");
    expect(warnings.some((w) => w.includes("Decision"))).toBe(true);
  });

  test("blank Rights/Stakes/Hurts/Priority/Job/Out-of-scope/Basis stay undefined -- blank is a legitimate answer, not a defect", () => {
    const { rows, warnings } = parseManifest(manifestWithRow(blankRow()));
    expect(rows[0]?.rights).toBeUndefined();
    expect(rows[0]?.stakes).toBeUndefined();
    expect(rows[0]?.hurts).toBeUndefined();
    expect(rows[0]?.priority).toBeUndefined();
    expect(rows[0]?.job).toBeUndefined();
    expect(rows[0]?.outOfScope).toBeUndefined();
    expect(rows[0]?.basis).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  test("card-field cells parse as free text", () => {
    const { rows, warnings } = parseManifest(
      manifestWithRow(blankRow({ 10: "does the thing", 11: "not for x", 12: "Dana's way" })),
    );
    expect(rows[0]?.job).toBe("does the thing");
    expect(rows[0]?.outOfScope).toBe("not for x");
    expect(rows[0]?.basis).toBe("Dana's way");
    expect(warnings).toEqual([]);
  });

  test("a row with an empty Path is dropped with a warning, never silently kept as a phantom row", () => {
    const { rows, warnings } = parseManifest(manifestWithRow(blankRow({ 1: "" })));
    expect(rows).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("no table at all parses to zero rows with a warning, not a throw", () => {
    const { rows, warnings } = parseManifest("# Just a heading\n\nNo table here.\n");
    expect(rows).toEqual([]);
    expect(warnings.length).toBe(1);
  });
});

describe("parseManifest: old manifests with the retired Maturity column (issue #108)", () => {
  const OLD_HEADER =
    "| Name | Path | Mechanical Condition | Registry Evidence | Decision | Whose | Rights | Stakes | Hurts | Priority | Maturity |";
  const OLD_SEPARATOR = `|${OLD_HEADER.split("|").slice(1, -1).map(() => " --- ").join("|")}|`;

  const oldManifest = (cells: ReadonlyArray<string>): string =>
    ["# Adopt Triage Manifest", "", OLD_HEADER, OLD_SEPARATOR, `| ${cells.join(" | ")} |`, ""].join("\n");

  test("parses with ONE warning naming the ignored column; maturity never reaches the row", () => {
    const { rows, warnings } = parseManifest(
      oldManifest(["x", "some/path", "bare", "bare", "keep", "mine", "", "load-bearing", "it hurts", "3", "working"]),
    );
    expect(warnings).toEqual(['adopt-manifest.md: ignoring unrecognized column "Maturity" (its cells are not read)']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      baseRow({
        name: "x",
        path: "some/path",
        mechanicalCondition: bareCondition,
        stakes: "load-bearing",
        hurts: "it hurts",
        priority: 3,
      }),
    );
    // The retired self-grade is not preserved into execution in ANY form.
    expect(Object.values(rows[0] ?? {})).not.toContain("working");
  });

  test("the missing Job/Out-of-scope/Basis columns read as not-asked -- honest gaps, no warning about them", () => {
    const { rows, warnings } = parseManifest(
      oldManifest(["x", "some/path", "bare", "bare", "keep", "mine", "", "", "", "", "idea"]),
    );
    expect(rows[0]?.job).toBeUndefined();
    expect(rows[0]?.outOfScope).toBeUndefined();
    expect(rows[0]?.basis).toBeUndefined();
    expect(warnings.filter((w) => !w.includes('column "Maturity"'))).toEqual([]);
  });
});

describe("deriveEntryStage: the system's own placement, from observables (issue #108)", () => {
  test("parses + complete -> evaluating (runnable output present; the remaining work is proving it)", () => {
    expect(deriveEntryStage({ parses: true, complete: true })).toBe("evaluating");
    // hasEvals plays no part -- the parameter type omits it entirely, and a
    // full MechanicalCondition (extra field and all) is still accepted.
    expect(deriveEntryStage(fullCondition)).toBe("evaluating");
  });

  test("parses but incomplete -> drafting (skill text exists, identity doesn't)", () => {
    expect(deriveEntryStage({ parses: true, complete: false })).toBe("drafting");
  });

  test("does not parse -> idea", () => {
    expect(deriveEntryStage({ parses: false, complete: false })).toBe("idea");
    expect(deriveEntryStage(bareCondition)).toBe("idea");
  });
});

describe("triageWorkspace: discovery + defaults", () => {
  const journalFor = (dir: string) => join(dir, ".skillmaker", "events.jsonl");

  test("a bare candidate defaults to keep/mine with bare evidence", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "browse/SKILL.md", skillMd("browse", "browse the web"));

        const result = yield* triageWorkspace(dir).pipe(Effect.provide(JournalLayer(journalFor(dir))));
        expect(result.rows).toHaveLength(1);
        const row = result.rows[0];
        expect(row?.path).toBe("browse");
        expect(row?.decision).toBe("keep");
        expect(row?.whose).toBe("mine");
        expect(row?.evidence).toEqual({ kind: "bare" });
        expect(row?.mechanicalCondition).toEqual({ parses: true, complete: true, hasEvals: false });
      }),
    );
  });

  test("a candidate missing description is mechanically incomplete", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "thin/SKILL.md", "---\nname: thin\n---\nNo description.\n");
        const result = yield* triageWorkspace(dir).pipe(Effect.provide(JournalLayer(journalFor(dir))));
        expect(result.rows[0]?.mechanicalCondition.complete).toBe(false);
        expect(result.rows[0]?.mechanicalCondition.parses).toBe(true);
      }),
    );
  });

  test("an already-adopted directory (has bundle.json) is skipped, not turned into a manifest row", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "already/SKILL.md", skillMd("already"));
        yield* write(dir, "already/bundle.json", JSON.stringify({ schemaVersion: 1, slug: "already" }));

        const result = yield* triageWorkspace(dir).pipe(Effect.provide(JournalLayer(journalFor(dir))));
        expect(result.rows).toHaveLength(0);
        expect(result.skipped).toEqual([{ path: "already", reason: "already-adopted" }]);
      }),
    );
  });

  test("acts on nothing: no bundle.json/marker is written, no journal event appended", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));
        yield* triageWorkspace(dir).pipe(Effect.provide(JournalLayer(journalFor(dir))));

        expect(yield* fs.exists(join(dir, "browse", "bundle.json"))).toBe(false);
        expect(yield* fs.exists(join(dir, "browse", ".skillmaker-adopt.json"))).toBe(false);
        expect(existsSync(journalFor(dir))).toBe(false);
      }),
    );
  });
});

describe("executeManifest: per-row execution mapping", () => {
  const journalFor = (dir: string) => join(dir, ".skillmaker", "events.jsonl");

  const readEvents = (journalPath: string): ReadonlyArray<{ type: string; payload: Record<string, unknown> }> =>
    readFileSync(journalPath, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));

  test("keep+mine with a complete SKILL.md enters at evaluating -- derived, no maturity question, NO override recorded", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "browse/SKILL.md", skillMd("browse", "browse the web"));
        const journalPath = journalFor(dir);

        const row = baseRow({ path: "browse", decision: "keep", whose: "mine" });
        const summary = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(summary.adopted).toBe(1);
        expect(summary.received).toBe(0);
        expect(summary.archived).toBe(0);
        expect(summary.outcomes[0]).toMatchObject({ kind: "adopted", path: "browse" });

        const events = readEvents(journalPath);
        expect(events.some((e) => e.type === "bundle.created")).toBe(true);
        const stageChange = events.find((e) => e.type === "bundle.stage_changed");
        expect(stageChange?.payload).toMatchObject({
          bundle: "browse",
          from: "idea",
          to: "evaluating",
          reason: TRIAGE_ENTRY_STAGE_REASON,
        });
        // The system's own placement at birth is not a human overriding the
        // guard -- no override field AT ALL, not even `false` (issue #108).
        expect(stageChange?.payload).not.toHaveProperty("override");
      }),
    );
  });

  test("keep+mine with a parsing-but-incomplete SKILL.md enters at drafting -- derived from the directory, not the manifest's own cell", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "thin/SKILL.md", "---\nname: thin\n---\nNo description yet.\n");
        const journalPath = journalFor(dir);
        // The row's mechanicalCondition cell CLAIMS full condition -- the
        // derivation must ignore it and read the directory itself (machine
        // columns are never load-bearing for execution).
        const row = baseRow({ path: "thin", decision: "keep", whose: "mine", mechanicalCondition: fullCondition });
        yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));

        const stageChange = readEvents(journalPath).find((e) => e.type === "bundle.stage_changed");
        expect(stageChange?.payload).toMatchObject({ from: "idea", to: "drafting", reason: TRIAGE_ENTRY_STAGE_REASON });
        expect(stageChange?.payload).not.toHaveProperty("override");
      }),
    );
  });

  test("keep+mine with no frontmatter at all stays at idea: no stage move appended", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "scrap/SKILL.md", "# scrap\n\nJust a sketch, no frontmatter.\n");
        const journalPath = journalFor(dir);
        const row = baseRow({ path: "scrap", decision: "keep", whose: "mine" });
        yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));
        const events = readEvents(journalPath);
        expect(events.some((e) => e.type === "bundle.stage_changed")).toBe(false);
      }),
    );
  });

  test("archive routes through adopt + bundle.archived, no derived stage move", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "old-thing/SKILL.md", skillMd("old-thing"));
        const journalPath = journalFor(dir);
        const row = baseRow({ path: "old-thing", decision: "archive", whose: "mine" });
        const summary = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(summary.archived).toBe(1);
        expect(summary.adopted).toBe(0);
        const events = readEvents(journalPath);
        expect(events.some((e) => e.type === "bundle.archived")).toBe(true);
        expect(events.some((e) => e.type === "bundle.stage_changed")).toBe(false);
      }),
    );
  });

  test("keep+outside routes through receive: skill.received, no bundle field, no identity written", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* write(dir, "arrival/SKILL.md", skillMd("arrival", "arrived from a colleague"));
        const journalPath = journalFor(dir);

        const row = baseRow({
          path: "arrival",
          name: "arrival",
          decision: "keep",
          whose: "outside",
          rights: "unclear",
          stakes: "load-bearing",
          hurts: "check licensing",
          priority: 12,
        });
        const summary = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(summary.received).toBe(1);
        expect(summary.adopted).toBe(0);
        expect(summary.todosMinted).toBe(1);
        expect(yield* fs.exists(join(dir, "arrival", "bundle.json"))).toBe(false);

        const events = readEvents(journalPath);
        const received = events.find((e) => e.type === "skill.received");
        expect(received?.payload).toMatchObject({
          source: "outside",
          claimedName: "arrival",
          rights: "unclear",
          // Structured testimony fields (issue #108), never flattened prose.
          stakes: "load-bearing",
          hurts: "check licensing",
        });
        expect(received?.payload).not.toHaveProperty("notes");
        const todo = events.find((e) => e.type === "todo.opened");
        expect((todo?.payload as { todo: Record<string, unknown> }).todo).toMatchObject({
          title: "check licensing",
          priority: 12,
          origin: { kind: "intake" },
        });
        expect((todo?.payload as { todo: Record<string, unknown> }).todo.bundle).toBeUndefined();
      }),
    );
  });

  test("skip leaves the directory untouched: no journal event at all", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* write(dir, "leave-me/SKILL.md", skillMd("leave-me"));
        const journalPath = journalFor(dir);
        const row = baseRow({ path: "leave-me", decision: "skip" });
        const summary = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(summary.skipped).toBe(1);
        expect(summary.outcomes[0]).toEqual({ kind: "skipped", path: "leave-me", reason: "skip" });
        expect(yield* fs.exists(join(dir, "leave-me", "bundle.json"))).toBe(false);
        expect(existsSync(journalPath)).toBe(false);
      }),
    );
  });

  test("a row pointing at a vanished directory errors honestly, without stopping the other rows", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "still-here/SKILL.md", skillMd("still-here"));
        const journalPath = journalFor(dir);
        const rows = [
          baseRow({ path: "vanished", decision: "keep", whose: "mine" }),
          baseRow({ path: "still-here", decision: "keep", whose: "mine" }),
        ];
        const summary = yield* executeManifest(dir, rows, actor).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(summary.errored).toBe(1);
        expect(summary.adopted).toBe(1);
        expect(summary.outcomes[0]?.kind).toBe("errored");
        expect(summary.outcomes[1]?.kind).toBe("adopted");
      }),
    );
  });

  test("idempotent re-run: a directory that already holds bundle.json is skipped, not re-adopted", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));
        const journalPath = journalFor(dir);
        const row = baseRow({ path: "browse", decision: "keep", whose: "mine" });

        const first = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(first.adopted).toBe(1);

        const second = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(second.adopted).toBe(0);
        expect(second.skipped).toBe(1);
        expect(second.outcomes[0]).toEqual({ kind: "skipped", path: "browse", reason: "already-adopted" });
      }),
    );
  });

  test("two rows with the same directory basename never collide on slug (usedSlugs threaded across the whole run)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "a/browse/SKILL.md", skillMd("browse"));
        yield* write(dir, "b/browse/SKILL.md", skillMd("browse"));
        const journalPath = journalFor(dir);
        const rows = [
          baseRow({ path: "a/browse", decision: "keep", whose: "mine" }),
          baseRow({ path: "b/browse", decision: "keep", whose: "mine" }),
        ];
        const summary = yield* executeManifest(dir, rows, actor).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(summary.adopted).toBe(2);
        const slugs = summary.outcomes.map((o) => (o.kind === "adopted" ? o.slug : undefined));
        expect(new Set(slugs).size).toBe(2);
      }),
    );
  });

  test("no hurts text mints no todo", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));
        const journalPath = journalFor(dir);
        const row = baseRow({ path: "browse", decision: "keep", whose: "mine" });
        const summary = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(summary.todosMinted).toBe(0);
        const events = readEvents(journalPath);
        expect(events.some((e) => e.type === "todo.opened")).toBe(false);
      }),
    );
  });

  test("adopt path seeds the freshly created dossier's Job/Out-of-scope/Basis from the row's card answers (issue #108)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "browse/SKILL.md", skillMd("browse", "browse the web"));
        const journalPath = journalFor(dir);
        const row = baseRow({
          path: "browse",
          decision: "keep",
          whose: "mine",
          job: "Browses the web for a given query",
          outOfScope: "Not for authenticated sites",
          basis: "Dana's crawling checklist",
        });
        const summary = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));
        expect(summary.adopted).toBe(1);
        expect(summary.warnings).toEqual([]);

        const { sections, warnings } = yield* parseDossier(join(dir, "browse", "dossier.md"));
        expect(warnings).toEqual([]);
        expect(sections.job).toBe("Browses the web for a given query");
        expect(sections.outOfScope).toBe("Not for authenticated sites");
        expect(sections.basis).toBe("Dana's crawling checklist");
        // Unanswered sections stay honest gaps.
        expect(sections.evidence).toBeUndefined();
        expect(sections.fitCriterion).toBeUndefined();
      }),
    );
  });

  test("adopt path NEVER clobbers a dossier that traveled with the directory -- the manifest's answers lose to the file", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));
        yield* write(dir, "browse/dossier.md", "## Job\nAlready hand-authored.\n");
        const journalPath = journalFor(dir);
        const row = baseRow({ path: "browse", decision: "keep", whose: "mine", job: "the manifest's late answer" });
        yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));

        const content = yield* fs.readFileString(join(dir, "browse", "dossier.md"));
        expect(content).toBe("## Job\nAlready hand-authored.\n");
      }),
    );
  });

  test("card answers on a receive row warn -- a crate has no dossier -- and never fail the row (issue #108)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "arrival/SKILL.md", skillMd("arrival"));
        const journalPath = journalFor(dir);
        const row = baseRow({
          path: "arrival",
          name: "arrival",
          decision: "keep",
          whose: "outside",
          job: "does a thing",
          basis: "someone's way",
        });
        const summary = yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(summary.received).toBe(1);
        expect(summary.errored).toBe(0);
        expect(summary.warnings).toHaveLength(1);
        expect(summary.warnings[0]).toContain("Job/Basis");
        expect(summary.warnings[0]).toContain("land nowhere until a door grants identity");
      }),
    );
  });

  test("a usage claim never moves a stage: a received crate with stakes/hurts appends no bundle.stage_changed and stays Unverified (issue #108 acceptance)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "arrival/SKILL.md", skillMd("arrival", "arrived with a big claim")); // complete + runnable -- and still must not move
        const journalPath = journalFor(dir);
        const row = baseRow({
          path: "arrival",
          name: "arrival",
          decision: "keep",
          whose: "outside",
          stakes: "load-bearing",
          hurts: "breaks weekly in prod",
        });
        yield* executeManifest(dir, [row], actor).pipe(Effect.provide(JournalLayer(journalPath)));

        const events = readEvents(journalPath);
        expect(events.some((e) => e.type === "bundle.stage_changed")).toBe(false);
        // The badge derivation: received identity + zero graded measurements
        // ever = Unverified, and the maker's stakes/hurts testimony plays no
        // part in that formula at all (its only inputs are receipt +
        // measurement count).
        expect(isUnverified(true, 0)).toBe(true);
      }),
    );
  });
});
