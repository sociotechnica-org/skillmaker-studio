import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { layer as JournalLayer, Journal } from "../src/JournalService.ts";
import { shipBundle } from "../src/Ship.ts";
import { computeBundleHashes } from "../src/Versions.ts";
import { withTempDir } from "./support/TestLayer.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

const writeBundle = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    yield* fs.makeDirectory(join(dir, "output"), { recursive: true });
    yield* fs.writeFileString(join(dir, "design.md"), "# Demo\n\nA demo skill.\n");
    yield* fs.writeFileString(join(dir, "output", "SKILL.md"), "# Demo skill\n\nDo the thing.\n");
  });

const writeGradedRun = (
  bundleDir: string,
  input: { readonly id: string; readonly versionHash: string; readonly fixtureCase: string },
) => {
  const runDir = join(bundleDir, "runs", input.id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "run.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: input.id,
        bundle: "demo",
        kind: "eval",
        station: null,
        fixtureCase: input.fixtureCase,
        skillVersionHash: input.versionHash,
        provider: "claude-code",
        model: "fake-model-1",
        startedAt: "2026-07-10T00:00:00.000Z",
        endedAt: "2026-07-10T00:01:00.000Z",
        status: "completed",
        actor: { kind: "process", name: "run-engine" },
      },
      undefined,
      2,
    ),
  );
};

describe("shipBundle", () => {
  test("errors with ShipNoVersionError when the bundle has never had a version recorded", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const outcome = yield* shipBundle({
          workspaceRoot: dir,
          bundleDir,
          bundle: "demo",
          destination: "acme-agent-fleet",
          purpose: "eval harness",
          actor,
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("ShipNoVersionError");
      }),
    );
  });

  test("ships the latest recorded version by default, snapshotting its measurement receipts", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);
        writeGradedRun(bundleDir, { id: "run-1", versionHash: outputHash, fixtureCase: "golden-basic" });

        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          // IndexService.rebuild only scans a bundle's runs/ directory for
          // slugs it already knows about (from bundle identities OR
          // foldBundleStates) -- a bare skill.version_recorded/run.graded
          // pair with no bundle.created is invisible to it.
          yield* journal.append({ type: "bundle.created", actor, payload: { bundle: "demo" } });
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            payload: { bundle: "demo", hash: outputHash, designHash },
          });
          yield* journal.append({
            type: "run.graded",
            actor,
            payload: { id: "run-1", verdict: "pass" },
          });
          return yield* shipBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            destination: "acme-agent-fleet",
            purpose: "eval harness for team X",
            actor,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.versionHash).toBe(outputHash);
        expect(result.destination).toBe("acme-agent-fleet");
        expect(result.purpose).toBe("eval harness for team X");
        expect(result.drift).toBe("in-sync");
        expect(result.receipts).toHaveLength(1);
        expect(result.receipts[0]).toMatchObject({
          fixtureCase: "golden-basic",
          provider: "claude-code",
          model: "fake-model-1",
          n: 1,
          passes: 1,
          passRate: 1,
        });

        const fs = yield* FileSystem;
        const raw = yield* fs.readFileString(journalPath);
        const lines = raw.trim().split("\n");
        const shipEvent = lines
          .map((line) => JSON.parse(line) as { type: string; idempotencyKey?: string })
          .find((event) => event.type === "skill.shipped");
        expect(shipEvent).toBeDefined();
        expect(shipEvent?.idempotencyKey).toBeUndefined();
      }),
    );
  });

  test("re-shipping the same version to the same destination appends a second, distinct event (no idempotency key)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            payload: { bundle: "demo", hash: outputHash, designHash },
          });
          yield* shipBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            destination: "acme-agent-fleet",
            purpose: "eval harness",
            actor,
          });
          yield* shipBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            destination: "acme-agent-fleet",
            purpose: "eval harness",
            actor,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        const fs = yield* FileSystem;
        const raw = yield* fs.readFileString(journalPath);
        const lines = raw.trim().split("\n");
        const shipCount = lines.filter((line) => (JSON.parse(line) as { type: string }).type === "skill.shipped").length;
        expect(shipCount).toBe(2);
      }),
    );
  });

  test("warns via drift (does not block) when live content has changed since the shipped version", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const fs = yield* FileSystem;
        yield* fs.writeFileString(join(bundleDir, "output", "SKILL.md"), "# Demo skill\n\nDo the updated thing.\n");

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            payload: { bundle: "demo", hash: outputHash, designHash },
          });
          return yield* shipBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            destination: "acme-agent-fleet",
            purpose: "eval harness",
            actor,
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.drift).toBe("output-hand-edited");
        expect(result.versionHash).toBe(outputHash);
      }),
    );
  });

  test("--version <prefix> selects a specific recorded version, not just the latest", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const first = yield* computeBundleHashes(bundleDir);

        const fs = yield* FileSystem;
        yield* fs.writeFileString(join(bundleDir, "output", "SKILL.md"), "# Demo skill\n\nDo the updated thing.\n");
        const second = yield* computeBundleHashes(bundleDir);

        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const result = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            payload: { bundle: "demo", hash: first.outputHash, designHash: first.designHash, label: "v1" },
          });
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            payload: { bundle: "demo", hash: second.outputHash, designHash: second.designHash, label: "v2" },
          });
          return yield* shipBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            destination: "acme-agent-fleet",
            purpose: "eval harness",
            actor,
            versionHashPrefix: first.outputHash.slice(0, 20),
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)));

        expect(result.versionHash).toBe(first.outputHash);
        expect(result.versionLabel).toBe("v1");
        // Live content now matches "v2", not the shipped "v1" -- drift is
        // surfaced, never blocked.
        expect(result.drift).not.toBe("in-sync");
      }),
    );
  });

  test("errors with ShipVersionNotFoundError when --version matches no recorded hash", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const bundleDir = join(dir, "skills", "demo");
        yield* writeBundle(bundleDir);
        const { designHash, outputHash } = yield* computeBundleHashes(bundleDir);
        const journalPath = join(dir, ".skillmaker", "events.jsonl");

        const outcome = yield* Effect.gen(function* () {
          const journal = yield* Journal;
          yield* journal.append({
            type: "skill.version_recorded",
            actor,
            payload: { bundle: "demo", hash: outputHash, designHash },
          });
          return yield* shipBundle({
            workspaceRoot: dir,
            bundleDir,
            bundle: "demo",
            destination: "acme-agent-fleet",
            purpose: "eval harness",
            actor,
            versionHashPrefix: "sha256:doesnotexist",
          });
        }).pipe(Effect.provide(JournalLayer(journalPath)), Effect.flip);

        expect(outcome._tag).toBe("ShipVersionNotFoundError");
      }),
    );
  });
});
