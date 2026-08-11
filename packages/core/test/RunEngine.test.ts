/**
 * Integration tests for core's run dispatch wrapper (`runFixture`) — the
 * workspace/journal-facing half of a run. The execution mechanics' unit
 * tests moved to packages/runner/test/Runner.test.ts (THE MERGE tranche 2);
 * these tests prove the wrapper still drives the runner end to end through
 * a real workspace + journal, unchanged behavior.
 */
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Actor } from "../src/Actor.ts";
import { layer as JournalLayer } from "../src/JournalService.ts";
import { runFixture } from "../src/RunEngine.ts";
import { layer as WorkspaceLayer, Workspace } from "../src/WorkspaceService.ts";
import { withTempDir as withEffectTempDir } from "./support/TestLayer.ts";

// Fix F6: an end-to-end `runFixture` regression proving the isolation
// mechanism actually reaches the ACP adapter subprocess, not just that
// the engine *computes* an isolated path. A fake adapter test double
// (matching the `node -e <script>` pattern already used in
// AcpClient.test.ts) writes the env var it actually received to a marker
// file on `session/prompt`; the test reads that marker back after the run
// completes (the sandbox itself is cleaned up by then) and asserts it is a
// fresh, run-scoped path -- never the operator's real `$HOME`.
describe("runFixture sandbox isolation (Fix F6: an isolated CLAUDE_CONFIG_DIR reaches the adapter subprocess, and run.json records it)", () => {
  const actor = Actor.make({ kind: "user", name: "test-user" });

  const echoConfigDirToMarkerScript = `
    const readline = require("readline");
    const fs = require("fs");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
      } else if (msg.method === "session/new") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } }) + "\\n");
      } else if (msg.method === "session/prompt") {
        const markerPath = process.env.SKILLMAKER_TEST_MARKER_PATH;
        if (markerPath) {
          fs.writeFileSync(markerPath, JSON.stringify({
            claudeConfigDir: process.env.CLAUDE_CONFIG_DIR || null,
          }));
        }
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
      }
    });
  `;

  test("run.json records isolation: 'sandbox-home', and the adapter subprocess sees a fresh run-scoped CLAUDE_CONFIG_DIR -- never the operator's real $HOME", async () => {
    const markerDir = mkdtempSync(join(tmpdir(), "skillmaker-f6-marker-"));
    const markerPath = join(markerDir, "marker.json");
    const previousMarkerEnv = process.env.SKILLMAKER_TEST_MARKER_PATH;
    process.env.SKILLMAKER_TEST_MARKER_PATH = markerPath;

    try {
      await withEffectTempDir((dir) =>
        Effect.gen(function* () {
          const workspace = yield* Workspace;
          const initResult = yield* workspace.init(dir);
          yield* workspace.createBundle(dir, { slug: "demo" });

          const resolved = yield* workspace.resolve(dir);
          const bundleDir = join(initResult.root, resolved.config.skillsDir, "demo");
          writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Demo Skill\n\nSome instructions.\n");
          const caseDir = join(bundleDir, "evals", "fixtures", "golden-basic");
          mkdirSync(caseDir, { recursive: true });
          writeFileSync(join(caseDir, "prompt.md"), "Do the thing.\n");

          const config = { ...resolved.config, providers: { "claude-code": { command: ["node", "-e", echoConfigDirToMarkerScript] } } };

          const result = yield* runFixture({
            root: initResult.root,
            config,
            bundle: "demo",
            fixtureCase: "golden-basic",
            provider: "claude-code",
            actor,
          }).pipe(Effect.provide(JournalLayer(join(dir, ".skillmaker", "events.jsonl"))));

          expect(result.status).toBe("completed");

          const runJsonPath = join(bundleDir, "runs", result.runId, "run.json");
          const runJson = JSON.parse(readFileSync(runJsonPath, "utf8")) as { isolation?: string };
          expect(runJson.isolation).toBe("sandbox-home");
        }).pipe(Effect.provide(WorkspaceLayer)),
      );

      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as { claudeConfigDir: string | null };
      expect(marker.claudeConfigDir).not.toBeNull();
      expect(marker.claudeConfigDir).not.toBe(process.env.HOME);
      // Security amendment (Phase 20 Story 3 friction log F4): the isolated
      // config dir is a SIBLING mkdtemp'd directory
      // ("skillmaker-run-config-*"), structurally outside the disposable
      // per-run sandbox ("skillmaker-run-*") -- not nested inside it. This
      // is deliberate: it keeps any auth material seeded into the config
      // dir (see AuthSeeding.ts) permanently outside the before/after
      // workspace diff that becomes runs/<id>/artifacts/, rather than
      // relying on filename-based exclusion from that diff.
      expect(marker.claudeConfigDir).toContain("skillmaker-run-config-");
      expect(marker.claudeConfigDir).not.toContain(".skillmaker-sandbox-config");
    } finally {
      if (previousMarkerEnv === undefined) {
        delete process.env.SKILLMAKER_TEST_MARKER_PATH;
      } else {
        process.env.SKILLMAKER_TEST_MARKER_PATH = previousMarkerEnv;
      }
      rmSync(markerDir, { recursive: true, force: true });
    }
  }, 15_000);
});

describe("runFixture skillInvoked (Fix F7: didSkillActivate's signal is computed and persisted on every run, not just trigger-class fixtures)", () => {
  const actor = Actor.make({ kind: "user", name: "test-user" });

  // Emits a `tool_call` `session/update` notification naming the bundle's
  // skill (a Skill-tool-shaped update, mirroring claude-code-acp's real
  // wire shape per SkillActivation.ts's doc comment) before responding to
  // `session/prompt`, so `didSkillActivate` finds evidence in the
  // transcript.
  const invokesSkillScript = `
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
      } else if (msg.method === "session/new") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } }) + "\\n");
      } else if (msg.method === "session/prompt") {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: { sessionId: "s1", update: { sessionUpdate: "tool_call", title: "Skill", name: "Skill", input: { skill: "demo" } } },
        }) + "\\n");
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
      }
    });
  `;

  // Never emits any tool_call update -- a run where the transcript carries
  // no evidence the skill fired.
  const silentScript = `
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", (line) => {
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
      } else if (msg.method === "session/new") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "s1" } }) + "\\n");
      } else if (msg.method === "session/prompt") {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { stopReason: "end_turn" } }) + "\\n");
      }
    });
  `;

  const setUpBundleAndRun = (script: string) =>
    withEffectTempDir((dir) =>
      Effect.gen(function* () {
        const workspace = yield* Workspace;
        const initResult = yield* workspace.init(dir);
        yield* workspace.createBundle(dir, { slug: "demo" });

        const resolved = yield* workspace.resolve(dir);
        const bundleDir = join(initResult.root, resolved.config.skillsDir, "demo");
        writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Demo Skill\n\nSome instructions.\n");
        const caseDir = join(bundleDir, "evals", "fixtures", "golden-basic");
        mkdirSync(caseDir, { recursive: true });
        writeFileSync(join(caseDir, "prompt.md"), "Do the thing.\n");

        const config = {
          ...resolved.config,
          providers: { "claude-code": { command: ["node", "-e", script] } },
        };

        const result = yield* runFixture({
          root: initResult.root,
          config,
          bundle: "demo",
          fixtureCase: "golden-basic",
          provider: "claude-code",
          actor,
        }).pipe(Effect.provide(JournalLayer(join(dir, ".skillmaker", "events.jsonl"))));

        const runJsonPath = join(bundleDir, "runs", result.runId, "run.json");
        const runJson = JSON.parse(readFileSync(runJsonPath, "utf8")) as { skillInvoked?: boolean };
        return { result, runJson };
      }).pipe(Effect.provide(WorkspaceLayer)),
    );

  test("a transcript with a tool_call naming the skill -> skillInvoked: true in both the RunFixtureResult and run.json", async () => {
    const { result, runJson } = await setUpBundleAndRun(invokesSkillScript);
    expect(result.status).toBe("completed");
    expect(result.skillInvoked).toBe(true);
    expect(runJson.skillInvoked).toBe(true);
  }, 15_000);

  test("a transcript with no tool_call evidence -> skillInvoked: false, still persisted (not merely absent)", async () => {
    const { result, runJson } = await setUpBundleAndRun(silentScript);
    expect(result.status).toBe("completed");
    expect(result.skillInvoked).toBe(false);
    expect(runJson.skillInvoked).toBe(false);
  }, 15_000);
});
