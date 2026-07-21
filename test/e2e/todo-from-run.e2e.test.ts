/**
 * End-to-end: run findings become work (2026-07-21 simplification proposal,
 * D5; Ruling 4 of the 2026-07-20 restructure proposal). Same fake-ACP
 * harness as phase9 (no LLM, CI-safe): scaffold -> fixture -> a real run
 * through the fake adapter -> `todo add --from-run` -> assert the opened
 * todo carries `origin: {kind: "run", runId}`, defaults derive from the run
 * and are overridable, verdict stays orthogonal (an UNGRADED run mints a
 * todo), reindex preserves the origin, and the server's `POST /api/events`
 * door (the read-out's "this run surfaced work" affordance) validates the
 * run exists before appending.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeAdapterSuccess = join(import.meta.dir, "fixtures", "fake-acp-success.cjs");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;
let runId: string;

const runCli = (args: ReadonlyArray<string>, cwd: string = scratchDir) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

/** Scans stdout then stderr for the command's final JSON line (see phase8). */
const jsonFrom = <T>(result: ReturnType<typeof runCli>): T | undefined => {
  for (const stream of [result.stdout, result.stderr]) {
    for (const line of stream.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        return JSON.parse(trimmed) as T;
      } catch {
        // not the JSON line; keep scanning
      }
    }
  }
  return undefined;
};

interface TodoJsonOutput {
  readonly status: string;
  readonly id: string;
  readonly todo: {
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly title: string;
    readonly detail?: string;
    readonly priority: number;
    readonly bundle?: string;
    readonly origin?: { readonly kind: string; readonly runId: string };
  };
}

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-todo-from-run-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "run-todo-skill", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "other-skill", "--json"]).exitCode).toBe(0);

  const bundleDir = join(scratchDir, "skills", "run-todo-skill");
  writeFileSync(join(bundleDir, "output", "SKILL.md"), "# Run Todo Skill\n\nv1.\n");
  expect(runCli(["fixture", "add", "run-todo-skill", "hard-case-conflict", "--json"]).exitCode).toBe(0);
  writeFileSync(
    join(bundleDir, "evals", "fixtures", "hard-case-conflict", "prompt.md"),
    "Reconcile the conflicting sections.\n",
  );

  // Point the provider at the fake adapter and run for real -- the run this
  // suite turns into a todo. Deliberately NEVER graded: verdict and
  // disposition are orthogonal (D5), so the door must work on an ungraded run.
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command: ["node", fakeAdapterSuccess] };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const runResult = runCli([
    "run",
    "run-todo-skill",
    "--fixture",
    "hard-case-conflict",
    "--provider",
    "claude-code",
    "--json",
  ]);
  expect(runResult.exitCode).toBe(0);
  const runJson = jsonFrom<{ readonly status: string; readonly runId: string }>(runResult);
  expect(runJson?.status).toBe("completed");
  runId = String(runJson?.runId);
}, 120000);

afterAll(async () => {
  if (serverProcess !== undefined) {
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
  }
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("skillmaker todo add --from-run: validation", () => {
  test("an unknown run id is rejected honestly", () => {
    const result = runCli(["todo", "add", "Investigate", "--from-run", "01UNKNOWNRUNID"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no such run");
  });

  test("an explicit --bundle that disagrees with the run's own bundle is rejected honestly", () => {
    const result = runCli(["todo", "add", "Investigate", "--bundle", "other-skill", "--from-run", runId]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("run-todo-skill");
  });

  test("--from-run and --from-report together are a usage error", () => {
    const result = runCli(["todo", "add", "Investigate", "--from-run", runId, "--from-report", "evt-1"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("at most one of");
  });
});

describe("skillmaker todo add --from-run: happy path (run never graded -- disposition is verdict-orthogonal)", () => {
  test("defaults bundle/detail from the run, kind task, and stamps origin {kind: 'run', runId}", () => {
    const result = runCli([
      "todo",
      "add",
      "Resolve the design conflict this run surfaced",
      "--from-run",
      runId,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as TodoJsonOutput;
    expect(json.status).toBe("opened");
    expect(json.todo.bundle).toBe("run-todo-skill");
    expect(json.todo.kind).toBe("task");
    expect(json.todo.priority).toBe(30);
    expect(json.todo.detail).toContain(`Surfaced by eval run ${runId} (fixture hard-case-conflict).`);
    expect(json.todo.origin).toEqual({ kind: "run", runId });
  });

  test("every default is overridable via --kind/--detail/--priority", () => {
    const result = runCli([
      "todo",
      "add",
      "A sharper todo from the same run",
      "--from-run",
      runId,
      "--kind",
      "bug",
      "--detail",
      "Custom detail overriding the run summary.",
      "--priority",
      "5",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as TodoJsonOutput;
    expect(json.todo.kind).toBe("bug");
    expect(json.todo.priority).toBe(5);
    expect(json.todo.detail).toBe("Custom detail overriding the run summary.");
    expect(json.todo.origin).toEqual({ kind: "run", runId });
  });
});

describe("reindex + the server door (the read-out's 'this run surfaced work' affordance)", () => {
  test("reindex preserves the run origin, no warnings", () => {
    const result = runCli(["reindex", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { warnings: ReadonlyArray<unknown> };
    expect(json.warnings).toEqual([]);

    const listResult = runCli(["todo", "list", "--json"]);
    expect(listResult.exitCode).toBe(0);
    const listJson = JSON.parse(listResult.stdout) as {
      todos: ReadonlyArray<{
        readonly title: string;
        readonly origin?: { readonly kind: string; readonly runId: string };
      }>;
    };
    const fromRun = listJson.todos.find(
      (todo) => todo.title === "Resolve the design conflict this run surfaced",
    );
    expect(fromRun?.origin).toEqual({ kind: "run", runId });
  });

  beforeAll(async () => {
    const server = await startE2eServer({
      command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
      cwd: scratchDir,
    });
    serverProcess = server.process;
    baseUrl = server.baseUrl;
  }, 60000);

  test("POST /api/events rejects a todo.opened whose run origin names a run that doesn't exist", async () => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "todo.opened",
        payload: {
          todo: {
            id: "td-dangling-run",
            kind: "task",
            status: "open",
            title: "Points at a run that never happened",
            priority: 30,
            bundle: "run-todo-skill",
            created: "2026-07-21",
            source: { kind: "user", name: "viewer" },
            origin: { kind: "run", runId: "01NOSUCHRUN" },
          },
        },
      }),
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("no such run");
  });

  test("POST /api/events appends a run-origin todo when the run exists, and GET /api/todos serves it back", async () => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "todo.opened",
        payload: {
          todo: {
            id: "td-from-readout",
            kind: "task",
            status: "open",
            title: "Opened from the read-out panel",
            detail: `A note.\nSurfaced by run ${runId} (fixture hard-case-conflict).`,
            priority: 30,
            bundle: "run-todo-skill",
            created: "2026-07-21",
            source: { kind: "user", name: "viewer" },
            origin: { kind: "run", runId },
          },
        },
      }),
    });
    expect(response.status).toBe(200);

    const todosResponse = await fetch(`${baseUrl}/api/todos`);
    expect(todosResponse.status).toBe(200);
    const body = (await todosResponse.json()) as {
      todos: ReadonlyArray<{
        readonly id: string;
        readonly origin?: { readonly kind: string; readonly runId: string };
      }>;
    };
    const opened = body.todos.find((todo) => todo.id === "td-from-readout");
    expect(opened?.origin).toEqual({ kind: "run", runId });
  });
});
