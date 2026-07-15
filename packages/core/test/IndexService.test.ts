import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { layer as IndexServiceLayer, IndexService } from "../src/IndexService.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import { layer as WorkspaceLayer, Workspace } from "../src/WorkspaceService.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

describe("IndexService.rebuild", () => {
  test("scans skills/*/bundle.json and folds the journal into the bundles table", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "alpha" });
        yield* workspace.createBundle(dir, { slug: "beta" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:alpha",
            payload: { bundle: "alpha" },
          });
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:beta",
            payload: { bundle: "beta" },
          });
          yield* journal.append({
            type: "bundle.stage_changed",
            actor,
            payload: { bundle: "alpha", from: "idea", to: "researching" },
          });
          yield* journal.append({
            type: "review.requested",
            actor,
            payload: { bundle: "alpha", state: "researching" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.bundles).toBe(2);
          expect(result.events).toBe(4);
          expect(result.warnings).toEqual([]);

          const bundles = yield* index.listBundles();
          expect(bundles.length).toBe(2);

          const alpha = bundles.find((b) => b.slug === "alpha");
          expect(alpha).toMatchObject({
            slug: "alpha",
            name: "Alpha",
            oneLiner: "",
            tags: [],
            stage: "researching",
            substate: "awaiting-review",
            archived: false,
          });
          expect(typeof alpha?.created).toBe("string");

          const beta = yield* index.getBundle("beta");
          expect(beta?.stage).toBe("idea");
          expect(beta?.substate).toBe("working");
          expect(beta?.archived).toBe(false);

          const missing = yield* index.getBundle("does-not-exist");
          expect(missing).toBeUndefined();
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("stageChangedAt (issue #82): mirrors the fold's timestamp and survives a reindex", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "alpha" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:alpha",
            payload: { bundle: "alpha" },
          });
          yield* journal.append({
            type: "bundle.stage_changed",
            actor,
            payload: { bundle: "alpha", from: "idea", to: "published" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          yield* index.rebuild();
          const alpha = yield* index.getBundle("alpha");
          expect(typeof alpha?.stageChangedAt).toBe("string");
          const firstStageChangedAt = alpha?.stageChangedAt;

          // Reindex is a full rebuild from the same journal (no schema
          // migration code) -- the timestamp is derived fresh every time
          // and must come out identical, not drift or reset.
          yield* index.rebuild();
          const alphaAgain = yield* index.getBundle("alpha");
          expect(alphaAgain?.stageChangedAt).toBe(firstStageChangedAt);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("a bundle on disk but absent from the journal appears with default state", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "orphan" });

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.warnings).toEqual([]);
          const bundle = yield* index.getBundle("orphan");
          expect(bundle?.stage).toBe("idea");
          expect(bundle?.substate).toBe("working");
          expect(bundle?.archived).toBe(false);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("a bundle in the journal but missing on disk appears with a warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            payload: { bundle: "ghost" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.warnings.length).toBe(1);
          expect(result.warnings[0]).toContain("ghost");
          const bundle = yield* index.getBundle("ghost");
          expect(bundle?.name).toBe("ghost");
          expect(bundle?.stage).toBe("idea");
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("malformed bundle.json produces a warning, not a failure", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "broken" });

        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* fs.writeFileString(
          path.join(dir, "skills", "broken", "bundle.json"),
          "{ this is not valid json",
        );

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.bundles).toBe(0);
          expect(result.warnings.length).toBe(1);
          expect(result.warnings[0]).toContain("broken");
          const bundles = yield* index.listBundles();
          expect(bundles.length).toBe(0);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("listBundles rebuilds automatically when studio.db is missing", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "fresh" });

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const bundles = yield* index.listBundles();
          expect(bundles.length).toBe(1);
          expect(bundles[0]?.slug).toBe("fresh");
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("folds todo.* events into the todos table with defaults, ordering, and derived archived", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        // `Journal.append` always stamps `at` with the real wall clock (by
        // design -- `JournalEventInput` omits `at`), so to exercise the
        // 7-day archive window deterministically we write the
        // `todo.status_changed` line directly as raw JSONL with a
        // long-past `at`, bypassing `append`.
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "todo.opened",
            actor,
            payload: {
              todo: {
                id: "td-1",
                kind: "bug",
                status: "open",
                title: "Fix crash",
                priority: 10,
                created: "2026-07-01",
                source: actor,
              },
            },
          });
          yield* journal.append({
            type: "todo.opened",
            actor,
            payload: {
              todo: {
                id: "td-2",
                kind: "task",
                status: "open",
                title: "Write docs",
                priority: 30,
                created: "2026-07-01",
                source: actor,
              },
            },
          });
          // Opened via `todo add --from-report` (issue #81) -- proves
          // `origin` round-trips through the `todos` table's `origin_json`
          // column, same guarded decode path fixtures' `source_json` uses.
          yield* journal.append({
            type: "todo.opened",
            actor,
            payload: {
              todo: {
                id: "td-3",
                kind: "bug",
                status: "open",
                title: "Investigate crash reported in the field",
                priority: 10,
                created: "2026-07-01",
                source: actor,
                origin: { kind: "field-report", ref: "evt-abc" },
              },
            },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const staleStatusChange = JSON.stringify({
          schemaVersion: 1,
          id: "00000000-0000-4000-8000-000000000099",
          at: "2026-01-01T00:00:00.000Z",
          actor,
          type: "todo.status_changed",
          payload: { id: "td-2", from: "open", to: "done" },
        });
        appendFileSync(journalPath, `${staleStatusChange}\n`);

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.todos).toBe(3);

          const openOnly = yield* index.listTodos();
          expect(openOnly.map((t) => t.id)).toEqual(["td-1", "td-3"]);

          const all = yield* index.listTodos({ includeArchived: true });
          expect(all.map((t) => t.id)).toEqual(["td-1", "td-3", "td-2"]);
          const done = all.find((t) => t.id === "td-2");
          expect(done?.archived).toBe(true);
          expect(done?.status).toBe("done");
          expect(done?.origin).toBeUndefined();

          const fromReport = all.find((t) => t.id === "td-3");
          expect(fromReport?.origin).toEqual({ kind: "field-report", ref: "evt-abc" });
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("rebuild is atomic: a concurrently-open reader keeps its old snapshot until it reopens", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "alpha" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        const dbPath = join(dir, ".skillmaker", "studio.db");

        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            payload: { bundle: "alpha" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          // Ensure studio.db exists with the initial snapshot.
          yield* index.rebuild();

          // Simulate a concurrent reader: open studio.db independently,
          // by file descriptor, before the next rebuild starts.
          const concurrentReader = new Database(dbPath, { readonly: true });
          const beforeCount = concurrentReader
            .query<{ readonly n: number }, []>("SELECT COUNT(*) as n FROM bundles")
            .get()?.n;
          expect(beforeCount).toBe(1);

          // Add a second bundle and rebuild -- this rewrites studio.db via
          // temp-file + rename.
          yield* Effect.gen(function* () {
            const journal = yield* Journal;
            yield* journal.append({
              type: "bundle.created",
              actor,
              payload: { bundle: "beta" },
            });
          }).pipe(Effect.provide(JournalLayer(journalPath)));
          yield* workspace.createBundle(dir, { slug: "beta" });

          yield* index.rebuild();

          // At the POSIX level, the already-open file descriptor still
          // points at the old, complete inode after `renameSync` swaps the
          // directory entry -- it can never observe a half-written file.
          // On macOS specifically, SQLite's Apple-vendored build adds its
          // own vnode-consistency check on top of that and raises
          // `SQLITE_IOERR_VNODE` instead of silently continuing to serve
          // the stale snapshot once it notices the path's inode changed
          // underneath it. Either outcome satisfies the property under
          // test -- the stale handle NEVER observes the new/replaced
          // data -- so both are accepted here; only a successful read
          // returning the *new* count would indicate a real problem.
          let afterCountOnOldHandle: number | undefined;
          let staleReadThrew = false;
          try {
            afterCountOnOldHandle = concurrentReader
              .query<{ readonly n: number }, []>("SELECT COUNT(*) as n FROM bundles")
              .get()?.n;
          } catch {
            staleReadThrew = true;
          }
          if (!staleReadThrew) {
            expect(afterCountOnOldHandle).toBe(1);
          }
          concurrentReader.close();

          // A fresh handle opened against the path now sees the new data.
          const freshReader = new Database(dbPath, { readonly: true });
          const freshCount = freshReader
            .query<{ readonly n: number }, []>("SELECT COUNT(*) as n FROM bundles")
            .get()?.n;
          expect(freshCount).toBe(2);
          freshReader.close();

          // And the service's own handle (reopened internally by rebuild())
          // also reflects the new data -- no partial state was ever visible
          // through either handle.
          const bundles = yield* index.listBundles();
          expect(bundles.length).toBe(2);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("populates fixtures, risk_coverage, and warnings tables (Phase 7)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "frame-the-problem" });

        const bundleDir = path.join(dir, "skills", "frame-the-problem");
        const caseDir = path.join(bundleDir, "evals", "fixtures", "refusal-thin-input");
        yield* fs.makeDirectory(caseDir, { recursive: true });
        yield* fs.writeFileString(
          path.join(caseDir, "case.json"),
          JSON.stringify({
            schemaVersion: 1,
            case: "refusal-thin-input",
            class: "refusal",
            risks: ["IN-1"],
          }),
        );
        yield* fs.writeFileString(path.join(caseDir, "prompt.md"), "Do the thing.\n");

        yield* fs.writeFileString(
          path.join(bundleDir, "evals", "risk-map.md"),
          `---
bundle: frame-the-problem
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty/thin input | ● covered | refusal-thin-input |
| ADV-1 | Prompt injection | ○ gap | — |
`,
        );

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.warnings).toEqual([]);

          const fixtures = yield* index.listFixtures("frame-the-problem");
          expect(fixtures).toEqual([
            {
              bundle: "frame-the-problem",
              caseName: "refusal-thin-input",
              class: "refusal",
              risks: ["IN-1"],
              hasPromptMd: true,
            },
          ]);

          const coverage = yield* index.listRiskCoverage("frame-the-problem");
          expect(coverage).toEqual([
            {
              bundle: "frame-the-problem",
              riskId: "ADV-1",
              family: "ADV",
              coverage: "gap",
            },
            {
              bundle: "frame-the-problem",
              riskId: "IN-1",
              family: "IN",
              coverage: "covered",
              fixtureCase: "refusal-thin-input",
            },
          ]);

          const warnings = yield* index.listWarnings();
          expect(warnings).toEqual([]);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("a broken case.json produces a persisted, queryable warning without failing rebuild", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "flaky" });

        const caseDir = path.join(dir, "skills", "flaky", "evals", "fixtures", "broken-case");
        yield* fs.makeDirectory(caseDir, { recursive: true });
        yield* fs.writeFileString(path.join(caseDir, "case.json"), "{ not valid json");

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.warnings.length).toBe(1);
          expect(result.warnings[0]).toContain("malformed JSON");

          const persisted = yield* index.listWarnings("flaky");
          expect(persisted.length).toBe(1);
          expect(persisted[0]?.source).toBe("fixtures");

          const allWarnings = yield* index.listWarnings();
          expect(allWarnings.length).toBe(1);

          // The bundle itself still lists and works.
          const bundle = yield* index.getBundle("flaky");
          expect(bundle?.slug).toBe("flaky");
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("a risk-map fixture reference to a nonexistent case produces a warning", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "gappy" });

        yield* fs.writeFileString(
          path.join(dir, "skills", "gappy", "evals", "risk-map.md"),
          `| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty input | ● covered | does-not-exist |
`,
        );

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.warnings.some((w) => w.includes("does-not-exist"))).toBe(true);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("respects config.skillsDir instead of a hardcoded 'skills'", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* workspace.init(dir);

        // Repoint skillsDir at a custom directory before scaffolding the
        // bundle -- WorkspaceService.createBundle re-reads the config each
        // call, so this alone is enough to relocate where bundles live.
        const configPath = path.join(dir, "skillmaker.config.json");
        const rawConfig = yield* fs.readFileString(configPath);
        const config = JSON.parse(rawConfig) as Record<string, unknown>;
        config["skillsDir"] = "custom-skills";
        yield* fs.writeFileString(configPath, JSON.stringify(config, null, 2));

        yield* workspace.createBundle(dir, { slug: "relocated" });

        const defaultSkillsDirExists = yield* fs.exists(path.join(dir, "skills", "relocated"));
        expect(defaultSkillsDirExists).toBe(false);
        const customSkillsDirExists = yield* fs.exists(path.join(dir, "custom-skills", "relocated"));
        expect(customSkillsDirExists).toBe(true);

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          const result = yield* index.rebuild();
          expect(result.warnings).toEqual([]);
          expect(result.bundles).toBe(1);

          const bundle = yield* index.getBundle("relocated");
          expect(bundle?.slug).toBe("relocated");
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });
});

describe("IndexService.listMeasurements", () => {
  interface RunJsonOverrides {
    readonly id: string;
    readonly fixtureCase?: string;
    readonly skillVersionHash?: string;
    readonly provider?: string;
    readonly model?: string;
    readonly status?: "running" | "completed" | "failed" | "infra-error";
  }

  const writeRunJson = (dir: string, slug: string, overrides: RunJsonOverrides): void => {
    const runDir = join(dir, "skills", slug, "runs", overrides.id);
    mkdirSync(runDir, { recursive: true });
    const record = {
      schemaVersion: 1,
      id: overrides.id,
      bundle: slug,
      kind: "eval",
      station: null,
      fixtureCase: overrides.fixtureCase ?? "golden-basic",
      skillVersionHash: overrides.skillVersionHash ?? "sha256:v1",
      provider: overrides.provider ?? "claude-code",
      model: overrides.model ?? "fake-model-1",
      startedAt: "2026-07-10T00:00:00.000Z",
      endedAt: "2026-07-10T00:01:00.000Z",
      status: overrides.status ?? "completed",
      actor: { kind: "process", name: "run-engine" },
    };
    writeFileSync(join(runDir, "run.json"), JSON.stringify(record, null, 2));
  };

  test("aggregates graded runs, never pooling across fixture/version/provider/model", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "example-skill" });

        writeRunJson(dir, "example-skill", { id: "run-1" });
        writeRunJson(dir, "example-skill", { id: "run-2" });
        writeRunJson(dir, "example-skill", { id: "run-3", skillVersionHash: "sha256:v2" });
        writeRunJson(dir, "example-skill", { id: "run-4", status: "running" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:example-skill",
            payload: { bundle: "example-skill" },
          });
          yield* journal.append({
            type: "run.graded",
            actor,
            payload: { id: "run-1", verdict: "pass" },
          });
          yield* journal.append({
            type: "run.graded",
            actor,
            payload: { id: "run-2", verdict: "fail" },
          });
          yield* journal.append({
            type: "run.graded",
            actor,
            payload: { id: "run-3", verdict: "pass" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          yield* index.rebuild();

          const measurements = yield* index.listMeasurements("example-skill");
          // v1 cell: run-1 (pass) + run-2 (fail) => n=2, passes=1. v2 cell:
          // run-3 (pass) => n=1, passes=1. run-4 (running, ungraded) never
          // contributes.
          expect(measurements).toHaveLength(2);
          const v1 = measurements.find((m) => m.versionHash === "sha256:v1");
          const v2 = measurements.find((m) => m.versionHash === "sha256:v2");
          expect(v1).toMatchObject({ n: 2, passes: 1, passRate: 0.5 });
          expect(v1?.ci).not.toBeNull();
          expect(v2).toMatchObject({ n: 1, passes: 1, passRate: 1 });
          // n=1 all-pass: Wilson's zero-failure bound is tighter than
          // rule-of-three's degenerate [0, 1] and wins.
          expect(v2?.ci?.[0]).toBeGreaterThan(0);
          expect(v2?.ci?.[1]).toBe(1);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });

  test("a regrade replaces the run's verdict -- latest wins, not accumulated as two samples", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "example-skill" });
        writeRunJson(dir, "example-skill", { id: "run-1" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:example-skill",
            payload: { bundle: "example-skill" },
          });
          yield* journal.append({ type: "run.graded", actor, payload: { id: "run-1", verdict: "pass" } });
          yield* journal.append({ type: "run.graded", actor, payload: { id: "run-1", verdict: "fail" } });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        yield* Effect.gen(function* () {
          const index = yield* IndexService;
          yield* index.rebuild();
          const measurements = yield* index.listMeasurements("example-skill");
          expect(measurements).toHaveLength(1);
          expect(measurements[0]).toMatchObject({ n: 1, passes: 0, passRate: 0 });
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });
});

describe("IndexService.rebuild -- duplicate skill.version_recorded tolerance", () => {
  // Fix F3/F4: reproduces a pre-existing bad journal line -- a second
  // `skill.version_recorded` event for the SAME (bundle, hash, designHash)
  // triple as an earlier one, written directly to `events.jsonl` (bypassing
  // `Journal.append`'s idempotency guard entirely, exactly as could happen
  // from a pre-fix `run` auto-record, or any other future writer that
  // forgets an idempotencyKey). Before this fix, `rebuild()` would let this
  // duplicate reach the `skill_versions` table's `(bundle, hash,
  // design_hash)` PRIMARY KEY, throw a raw SQLite UNIQUE violation, and wrap
  // it in an opaque "could not write studio.db" error -- bricking `list`,
  // `status`, `reindex`, and `measurements` for the ENTIRE workspace, not
  // just the one bad bundle. Now `rebuild()` must tolerate it (Ruling I):
  // skip the duplicate, warn, and keep indexing every other event/bundle.
  test("rebuild tolerates a pre-existing duplicate skill.version_recorded journal line: no throw, one version indexed, a warning surfaced, and all OTHER bundles/events still index cleanly", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "demo" });
        yield* workspace.createBundle(dir, { slug: "other" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");
        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:demo",
            payload: { bundle: "demo" },
          });
          yield* journal.append({
            type: "bundle.created",
            actor,
            idempotencyKey: "bundle.created:other",
            payload: { bundle: "other" },
          });
          // The first, legitimate `skill.version_recorded` for "demo" --
          // e.g. `adopt`'s labeled record.
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            idempotencyKey: "skill.version_recorded:demo:sha256:d1:sha256:h1",
            payload: { bundle: "demo", hash: "sha256:h1", designHash: "sha256:d1", label: "adopted" },
          });
          // An unrelated, perfectly valid event for a DIFFERENT bundle --
          // this must still index correctly despite the bad line below.
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            idempotencyKey: "skill.version_recorded:other:sha256:d9:sha256:h9",
            payload: { bundle: "other", hash: "sha256:h9", designHash: "sha256:d9" },
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        // The pre-existing bad line: a second `skill.version_recorded` for
        // "demo" with the IDENTICAL (bundle, hash, designHash) triple as
        // above, but a different idempotencyKey (as a pre-fix `run`
        // auto-record with no idempotencyKey guard would have produced) --
        // written directly to disk, bypassing `Journal.append` entirely, to
        // simulate a line already on disk from before this fix shipped.
        const duplicateLine = JSON.stringify({
          schemaVersion: 1,
          id: "00000000-0000-4000-8000-000000000042",
          at: "2026-07-05T00:00:00.000Z",
          actor,
          type: "skill.version_recorded",
          payload: { bundle: "demo", hash: "sha256:h1", designHash: "sha256:d1" },
        });
        appendFileSync(journalPath, `${duplicateLine}\n`);

        yield* Effect.gen(function* () {
          const index = yield* IndexService;

          // (a) rebuild() must not throw/fail despite the duplicate triple.
          const result = yield* index.rebuild();
          expect(result.bundles).toBe(2);

          // (b) exactly one version is indexed for the duplicated triple.
          const demoVersions = yield* index.listVersions("demo");
          expect(demoVersions.length).toBe(1);
          expect(demoVersions[0]).toMatchObject({ hash: "sha256:h1", designHash: "sha256:d1" });

          // (c) a warning is surfaced identifying the duplicate.
          const warnings = yield* index.listWarnings("demo");
          const duplicateWarning = warnings.find((w) => w.message.includes("duplicate skill.version_recorded"));
          expect(duplicateWarning).toBeDefined();
          expect(duplicateWarning?.message).toContain("demo");
          expect(duplicateWarning?.message).toContain("sha256:h1");
          expect(duplicateWarning?.message).toContain("sha256:d1");

          // (d) every OTHER bundle/event still indexes correctly -- the bad
          // line for "demo" never brings down the rest of the workspace.
          const otherVersions = yield* index.listVersions("other");
          expect(otherVersions.length).toBe(1);
          expect(otherVersions[0]).toMatchObject({ hash: "sha256:h9", designHash: "sha256:d9" });

          const bundles = yield* index.listBundles();
          expect(bundles.map((b) => b.slug).sort()).toEqual(["demo", "other"]);
        }).pipe(Effect.provide(IndexServiceLayer(dir)));
      }).pipe(Effect.provide(WorkspaceLayer)),
    );
  });
});
