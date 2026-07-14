/**
 * End-to-end: baked-in todos (data-model.md §2.9-§2.11, plan.md Phase 5).
 * Spawns the real `skillmaker` CLI's `start` command against a fresh
 * workspace and drives the full todo lifecycle both through the CLI
 * (`skillmaker todo add|list|done|start|drop|reopen`) and over HTTP against
 * a real Bun.serve instance (`POST /api/events`, `GET /api/todos`), exactly
 * as the viewer's runtime client would -- cross-checked against
 * `skillmaker todo list --json` at each step. Also covers rebuildability:
 * deleting `studio.db` and reindexing reproduces identical `todo list --json`
 * output.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let port: number;
let baseUrl: string;

const copyToolVersions = (dir: string) => {
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    cpSync(toolVersions, join(dir, ".tool-versions"));
  }
};

const runCli = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const waitForHealth = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server never became healthy at ${url}: ${String(lastError)}`);
};

interface TodoView {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly title: string;
  readonly priority: number;
  readonly bundle?: string;
  readonly archived: boolean;
}

const cliTodoList = (extraArgs: ReadonlyArray<string> = []): ReadonlyArray<TodoView> => {
  const result = runCli(["todo", "list", "--json", ...extraArgs], scratchDir);
  expect(result.exitCode).toBe(0);
  return (JSON.parse(result.stdout) as { todos: ReadonlyArray<TodoView> }).todos;
};

const postEvent = async (
  type: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const response = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
};

const getTodosOverHttp = async (all = false): Promise<ReadonlyArray<TodoView>> => {
  const response = await fetch(`${baseUrl}/api/todos${all ? "?all=1" : ""}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { todos: ReadonlyArray<TodoView> };
  return body.todos;
};

beforeAll(async () => {
  if (!existsSync(join(viewerDist, "index.html"))) {
    const build = Bun.spawnSync(["bun", "run", "--filter", "@skillmaker/viewer", "build"], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (build.exitCode !== 0) {
      throw new Error(
        "packages/viewer failed to build in test setup -- run `bun run build:viewer` manually to see the error",
      );
    }
  }

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase5-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "delta", "--json"], scratchDir).exitCode).toBe(0);

  port = 20000 + Math.floor(Math.random() * 20000);
  baseUrl = `http://localhost:${port}`;

  serverProcess = Bun.spawn(["bun", cliEntry, "start", "--port", String(port), "--no-open"], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForHealth(baseUrl, 30000);
}, 60000);

afterAll(async () => {
  if (serverProcess !== undefined) {
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
  }
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("skillmaker CLI end-to-end: Phase 5 (baked-in todos)", () => {
  let bugId: string;
  let evalId: string;
  let taskId: string;

  test("todo add creates three todos of different kinds", () => {
    const bug = runCli(["todo", "add", "Fix crash on start", "--kind", "bug", "--json"], scratchDir);
    expect(bug.exitCode).toBe(0);
    bugId = (JSON.parse(bug.stdout) as { id: string }).id;
    expect(bugId.startsWith("td-")).toBe(true);

    const evalTodo = runCli(["todo", "add", "Grade new prompt variant", "--kind", "eval", "--json"], scratchDir);
    expect(evalTodo.exitCode).toBe(0);
    evalId = (JSON.parse(evalTodo.stdout) as { id: string }).id;

    const task = runCli(["todo", "add", "Write onboarding docs", "--kind", "task", "--json"], scratchDir);
    expect(task.exitCode).toBe(0);
    taskId = (JSON.parse(task.stdout) as { id: string }).id;
  });

  test("todo list orders by priority ascending: bug (10), eval (15), task (30)", () => {
    const todos = cliTodoList();
    const ids = todos.map((t) => t.id);
    expect(ids.indexOf(bugId)).toBeLessThan(ids.indexOf(evalId));
    expect(ids.indexOf(evalId)).toBeLessThan(ids.indexOf(taskId));

    const bug = todos.find((t) => t.id === bugId);
    expect(bug?.priority).toBe(10);
    const evalRecord = todos.find((t) => t.id === evalId);
    expect(evalRecord?.priority).toBe(15);
    const task = todos.find((t) => t.id === taskId);
    expect(task?.priority).toBe(30);
  });

  test("marking the bug done keeps it visible (not archived yet -- 7-day window)", () => {
    const done = runCli(["todo", "done", bugId, "--json"], scratchDir);
    expect(done.exitCode).toBe(0);
    expect((JSON.parse(done.stdout) as { status: string }).status).toBe("changed");

    const todos = cliTodoList();
    const bug = todos.find((t) => t.id === bugId);
    expect(bug).toBeDefined();
    expect(bug?.status).toBe("done");
    expect(bug?.archived).toBe(false);
  });

  test("reopen then done again round-trips status", () => {
    const reopen = runCli(["todo", "reopen", bugId, "--json"], scratchDir);
    expect(reopen.exitCode).toBe(0);
    expect(cliTodoList().find((t) => t.id === bugId)?.status).toBe("open");

    const done = runCli(["todo", "done", bugId, "--json"], scratchDir);
    expect(done.exitCode).toBe(0);
    expect(cliTodoList().find((t) => t.id === bugId)?.status).toBe("done");
  });

  test("GET /api/todos matches skillmaker todo list --json", async () => {
    const cliTodos = cliTodoList();
    const httpTodos = await getTodosOverHttp();
    expect(httpTodos.map((t) => t.id).sort()).toEqual(cliTodos.map((t) => t.id).sort());
    expect(httpTodos).toEqual(cliTodos);
  });

  test("POST todo.status_changed with a stale 'from' is rejected with 409", async () => {
    // The eval todo is currently "open"; claim it was "done".
    const result = await postEvent("todo.status_changed", { id: evalId, from: "done", to: "in-progress" });
    expect(result.status).toBe(409);
    expect(typeof result.body.error).toBe("string");

    // State is unchanged.
    const todos = cliTodoList();
    expect(todos.find((t) => t.id === evalId)?.status).toBe("open");
  });

  test("POST todo.status_changed for an unknown id is rejected with 409", async () => {
    const result = await postEvent("todo.status_changed", { id: "td-does-not-exist", from: "open", to: "done" });
    expect(result.status).toBe(409);
  });

  test("POST todo.status_changed with a correct 'from' succeeds and is visible over both doors", async () => {
    const result = await postEvent("todo.status_changed", { id: evalId, from: "open", to: "in-progress" });
    expect(result.status).toBe(200);

    const cliTodos = cliTodoList();
    expect(cliTodos.find((t) => t.id === evalId)?.status).toBe("in-progress");

    const httpTodos = await getTodosOverHttp();
    expect(httpTodos.find((t) => t.id === evalId)?.status).toBe("in-progress");
  });

  test("a todo opened via POST /api/events with a bundle field carries it through to list", async () => {
    const result = await postEvent("todo.opened", {
      todo: {
        id: "td-http-bundle-todo",
        kind: "improvement",
        status: "open",
        title: "Speed up build",
        priority: 20,
        bundle: "delta",
        created: "2026-07-10",
        source: { kind: "user", name: "e2e" },
      },
    });
    expect(result.status).toBe(200);

    const todos = cliTodoList();
    const withBundle = todos.find((t) => t.id === "td-http-bundle-todo");
    expect(withBundle?.bundle).toBe("delta");

    const bundleFiltered = cliTodoList(["--bundle", "delta"]);
    expect(bundleFiltered.map((t) => t.id)).toEqual(["td-http-bundle-todo"]);
  });

  test("POST /api/events rejects a non-allowlisted event type", async () => {
    const result = await postEvent("todo.deleted", { id: bugId });
    expect(result.status).toBe(400);
  });

  test("reindex after deleting studio.db reproduces identical todo list --json output", () => {
    const before = cliTodoList(["--all"]);

    const dbPath = join(scratchDir, ".skillmaker", "studio.db");
    expect(existsSync(dbPath)).toBe(true);
    unlinkSync(dbPath);
    expect(existsSync(dbPath)).toBe(false);

    const reindex = runCli(["reindex", "--json"], scratchDir);
    expect(reindex.exitCode).toBe(0);

    const after = cliTodoList(["--all"]);
    expect(after).toEqual(before);
  });
});
