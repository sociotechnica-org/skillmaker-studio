/**
 * End-to-end: the Lab's two modes, Bench and Queue (issue #83). Spawns the
 * real `skillmaker start` server against a fresh workspace and exercises
 * the one new server-side contract this issue adds -- `GET /api/catalog`'s
 * `openTodoCount` (the Bench row's open-work signal) -- plus the
 * `POST /api/events` -> `GET /api/todos` round trip Queue's add form and
 * status toggle drive, exactly as the viewer's runtime client does. There
 * is no browser-level e2e harness in this repo (no playwright/jsdom
 * anywhere in the workspace, per `board-doorway.e2e.test.ts`'s own note):
 * the Bench/Queue mode split and the deep-link round trip are pure and
 * unit-tested without React in `packages/viewer/src/app/runtime/
 * labOrder.test.ts`, `runtime/todoQueue.test.ts`, and `runtime/
 * router.test.ts` (the last of these proves `?view=queue&bundle=<slug>`
 * round-trips through `parseRoute`/`labHref`). This suite proves the other
 * half: that the real server produces the counts those helpers depend on.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
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

interface CatalogRow {
  readonly slug: string;
  readonly openTodoCount: number;
}

const getCatalog = async (): Promise<ReadonlyArray<CatalogRow>> => {
  const response = await fetch(`${baseUrl}/api/catalog`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { entries: ReadonlyArray<CatalogRow> };
  return body.entries;
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

interface TodoView {
  readonly id: string;
  readonly status: string;
  readonly priority: number;
  readonly bundle?: string;
}

const getTodosOverHttp = async (): Promise<ReadonlyArray<TodoView>> => {
  const response = await fetch(`${baseUrl}/api/todos`);
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-lab-two-modes-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "gizmo", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "widget", "--json"], scratchDir).exitCode).toBe(0);

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

describe("issue #83: GET /api/catalog's openTodoCount", () => {
  test("a fresh workspace has zero open todos on every bundle", async () => {
    const entries = await getCatalog();
    expect(entries.map((e) => e.slug).sort()).toEqual(["gizmo", "widget"]);
    for (const entry of entries) {
      expect(entry.openTodoCount).toBe(0);
    }
  });

  let bugId: string;
  let secondBugId: string;

  test("todo.opened with a bundle bumps that bundle's count only", async () => {
    const opened = await postEvent("todo.opened", {
      todo: {
        id: "td-lab-two-modes-1",
        kind: "bug",
        status: "open",
        title: "Fix the widget crash",
        priority: 10,
        bundle: "widget",
        created: "2026-07-15",
        source: { kind: "user", name: "e2e" },
      },
    });
    expect(opened.status).toBe(200);
    bugId = "td-lab-two-modes-1";

    const entries = await getCatalog();
    expect(entries.find((e) => e.slug === "widget")?.openTodoCount).toBe(1);
    expect(entries.find((e) => e.slug === "gizmo")?.openTodoCount).toBe(0);
  });

  test("a second open todo on the same bundle adds to the count", async () => {
    const opened = await postEvent("todo.opened", {
      todo: {
        id: "td-lab-two-modes-2",
        kind: "improvement",
        status: "open",
        title: "Speed up the widget",
        priority: 20,
        bundle: "widget",
        created: "2026-07-15",
        source: { kind: "user", name: "e2e" },
      },
    });
    expect(opened.status).toBe(200);
    secondBugId = "td-lab-two-modes-2";

    const entries = await getCatalog();
    expect(entries.find((e) => e.slug === "widget")?.openTodoCount).toBe(2);
  });

  test("an app-level todo (no bundle) affects no bundle's count", async () => {
    const opened = await postEvent("todo.opened", {
      todo: {
        id: "td-lab-two-modes-app-level",
        kind: "task",
        status: "open",
        title: "Reorganize the docs",
        priority: 30,
        created: "2026-07-15",
        source: { kind: "user", name: "e2e" },
      },
    });
    expect(opened.status).toBe(200);

    const entries = await getCatalog();
    expect(entries.find((e) => e.slug === "widget")?.openTodoCount).toBe(2);
    expect(entries.find((e) => e.slug === "gizmo")?.openTodoCount).toBe(0);
  });

  test("marking a todo done drops it out of the (non-terminal) count", async () => {
    const changed = await postEvent("todo.status_changed", { id: bugId, from: "open", to: "done" });
    expect(changed.status).toBe(200);

    const entries = await getCatalog();
    expect(entries.find((e) => e.slug === "widget")?.openTodoCount).toBe(1);
  });

  test("marking a todo wont-do also drops it out of the count", async () => {
    const changed = await postEvent("todo.status_changed", { id: secondBugId, from: "open", to: "wont-do" });
    expect(changed.status).toBe(200);

    const entries = await getCatalog();
    expect(entries.find((e) => e.slug === "widget")?.openTodoCount).toBe(0);
  });

  test("reopening a done todo puts it back in the count -- derived fresh every request, never stored", async () => {
    const changed = await postEvent("todo.status_changed", { id: bugId, from: "done", to: "open" });
    expect(changed.status).toBe(200);

    const entries = await getCatalog();
    expect(entries.find((e) => e.slug === "widget")?.openTodoCount).toBe(1);
  });
});

describe("issue #83: Queue's write path -- the add form and status toggle over POST /api/events", () => {
  test("a todo opened through the generic events path (what Queue's add form calls) shows up priority-sorted via GET /api/todos", async () => {
    const opened = await postEvent("todo.opened", {
      todo: {
        id: "td-lab-two-modes-queue-add",
        kind: "bug",
        status: "open",
        title: "Opened from the Queue add form",
        priority: 10,
        bundle: "gizmo",
        created: "2026-07-15",
        source: { kind: "user", name: "viewer" },
      },
    });
    expect(opened.status).toBe(200);

    const todos = await getTodosOverHttp();
    const ids = todos.map((t) => t.id);
    expect(ids).toContain("td-lab-two-modes-queue-add");
    // Priority-ascending, same order Queue renders (data-model.md §2.10's compareTodos).
    for (let i = 1; i < todos.length; i++) {
      expect(todos[i - 1]!.priority).toBeLessThanOrEqual(todos[i]!.priority);
    }
  });
});
