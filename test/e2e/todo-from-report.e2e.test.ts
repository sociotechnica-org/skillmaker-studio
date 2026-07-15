/**
 * End-to-end: `skillmaker todo add --from-report` (issue #81, `Vision -
 * Board Lab Ship Receive.md`: "Receive produces signal -> signal becomes
 * Lab work"). Same harness as `harvest.e2e.test.ts`: scaffold -> record a
 * version -> `ship` -> `report` -> `todo add --from-report` -> assert the
 * opened todo carries `origin`, defaults are derived from the report and
 * overridable, `reindex` preserves `origin`, and `GET /api/field-reports`
 * shows the linked todo as a work chip.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

let failedReportId: string;
let surpriseReportId: string;
let wrongBundleReportId: string;
let notAReportEventId: string;

const runCli = (args: ReadonlyArray<string>, cwd: string = scratchDir) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const journalPath = () => join(scratchDir, ".skillmaker", "events.jsonl");

const journalEvents = (): ReadonlyArray<{
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}> =>
  readFileSync(journalPath(), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

const latestEventId = (type: string, bundle: string): string => {
  const matches = journalEvents().filter(
    (event) => event.type === type && event.payload.bundle === bundle,
  );
  const last = matches[matches.length - 1];
  if (last === undefined) {
    throw new Error(`no "${type}" event found for "${bundle}"`);
  }
  return last.id;
};

const waitForHealth = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server never became healthy at ${url}: ${String(lastError)}`);
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
    readonly origin?: { readonly kind: string; readonly ref: string };
  };
}

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-todo-from-report-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "demo-skill", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "other-skill", "--json"]).exitCode).toBe(0);

  for (const slug of ["demo-skill", "other-skill"]) {
    const dir = join(scratchDir, "skills", slug);
    writeFileSync(join(dir, "design.md"), `# ${slug}\n\nA demo skill for the todo-from-report e2e suite.\n`);
    writeFileSync(
      join(dir, "output", "SKILL.md"),
      `---\nname: ${slug}\ndescription: a demo skill for the todo-from-report e2e suite.\n---\n\nDo the demo thing.\n`,
    );
  }

  expect(runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]).exitCode).toBe(0);
  expect(
    runCli(["ship", "demo-skill", "--to", "acme-agent-fleet", "--purpose", "eval harness for team X", "--json"])
      .exitCode,
  ).toBe(0);

  // A non-field-report event, to prove `todo add --from-report` rejects it.
  notAReportEventId = latestEventId("skill.version_recorded", "demo-skill");

  // A field report for a DIFFERENT bundle, to prove `--bundle demo-skill
  // --from-report <this>` is rejected as a bundle disagreement.
  expect(
    runCli(["report", "other-skill", "--outcome", "failed", "--note", "Broke on other-skill.", "--json"])
      .exitCode,
  ).toBe(0);
  wrongBundleReportId = latestEventId("skill.field_report", "other-skill");

  // The report this suite actually turns into a todo.
  expect(
    runCli([
      "report",
      "demo-skill",
      "--outcome",
      "failed",
      "--note",
      "Broke on a repo with no package.json.",
      "--from",
      "acme-agent-fleet",
      "--json",
    ]).exitCode,
  ).toBe(0);
  failedReportId = latestEventId("skill.field_report", "demo-skill");

  // A second report on the same bundle -- used by the "every default is
  // overridable" test below, so both reports end up with a linked todo and
  // `wrongBundleReportId` is the only one left unlinked for the join test.
  expect(
    runCli(["report", "demo-skill", "--outcome", "surprise", "--note", "Used an unexpected tool.", "--json"])
      .exitCode,
  ).toBe(0);
  surpriseReportId = latestEventId("skill.field_report", "demo-skill");
});

afterAll(async () => {
  if (serverProcess !== undefined) {
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
  }
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("skillmaker todo add --from-report: validation", () => {
  test("an unknown event id is rejected honestly", () => {
    const result = runCli([
      "todo",
      "add",
      "Investigate",
      "--from-report",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no such event");
  });

  test("an event that isn't a skill.field_report is rejected honestly", () => {
    const result = runCli(["todo", "add", "Investigate", "--from-report", notAReportEventId]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a skill.field_report");
  });

  test("an explicit --bundle that disagrees with the report's own bundle is rejected honestly", () => {
    const result = runCli([
      "todo",
      "add",
      "Investigate",
      "--bundle",
      "demo-skill",
      "--from-report",
      wrongBundleReportId,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("other-skill");
  });

  test("an invalid --kind is still rejected before any journal read", () => {
    const result = runCli([
      "todo",
      "add",
      "Investigate",
      "--from-report",
      failedReportId,
      "--kind",
      "not-a-kind",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--kind");
  });
});

describe("skillmaker todo add --from-report: happy path", () => {
  test("defaults bundle/kind/detail from the report and stamps origin", () => {
    const result = runCli([
      "todo",
      "add",
      "Fix the missing package.json crash",
      "--from-report",
      failedReportId,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as TodoJsonOutput;
    expect(json.status).toBe("opened");
    expect(json.todo.title).toBe("Fix the missing package.json crash");
    expect(json.todo.bundle).toBe("demo-skill");
    // failed -> bug (data-model.md; issue #81's kind-by-outcome default).
    expect(json.todo.kind).toBe("bug");
    expect(json.todo.priority).toBe(10);
    expect(json.todo.detail).toBe("Broke on a repo with no package.json.\nDestination: acme-agent-fleet");
    expect(json.todo.origin).toEqual({ kind: "field-report", ref: failedReportId });
  });

  test("every default is overridable via --kind/--bundle/--detail/--priority", () => {
    const result = runCli([
      "todo",
      "add",
      "A different todo from the same surprise",
      "--from-report",
      surpriseReportId,
      "--kind",
      "improvement",
      "--bundle",
      "demo-skill",
      "--detail",
      "Custom detail overriding the report text.",
      "--priority",
      "99",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as TodoJsonOutput;
    expect(json.todo.kind).toBe("improvement");
    expect(json.todo.priority).toBe(99);
    expect(json.todo.detail).toBe("Custom detail overriding the report text.");
    expect(json.todo.origin).toEqual({ kind: "field-report", ref: surpriseReportId });
  });
});

describe("skillmaker todo add --from-report: reindex + server surfaces the work chip", () => {
  test("reindex preserves origin, no warnings", () => {
    const result = runCli(["reindex", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { warnings: ReadonlyArray<unknown> };
    expect(json.warnings).toEqual([]);

    const listResult = runCli(["todo", "list", "--json"]);
    expect(listResult.exitCode).toBe(0);
    const listJson = JSON.parse(listResult.stdout) as {
      todos: ReadonlyArray<{ readonly id: string; readonly origin?: { readonly kind: string; readonly ref: string } }>;
    };
    const fromFailedReport = listJson.todos.find((todo) => todo.origin?.ref === failedReportId);
    expect(fromFailedReport?.origin).toEqual({ kind: "field-report", ref: failedReportId });
  });

  beforeAll(async () => {
    const port = 25000 + Math.floor(Math.random() * 8000);
    baseUrl = `http://localhost:${port}`;
    serverProcess = Bun.spawn(["bun", cliEntry, "start", "--port", String(port), "--no-open"], {
      cwd: scratchDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await waitForHealth(baseUrl, 30000);
  }, 60000);

  interface FieldReportView {
    readonly id: string;
    readonly bundle: string;
    readonly todo: { readonly id: string; readonly title: string; readonly status: string } | null;
  }

  test("GET /api/field-reports shows the linked todo as a work chip and leaves an unlinked report null", async () => {
    const response = await fetch(`${baseUrl}/api/field-reports`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reports: ReadonlyArray<FieldReportView> };

    const linked = body.reports.find((report) => report.id === failedReportId);
    expect(linked?.todo?.title).toBe("Fix the missing package.json crash");
    expect(linked?.todo?.status).toBe("open");

    const alsoLinked = body.reports.find((report) => report.id === surpriseReportId);
    expect(alsoLinked?.todo?.title).toBe("A different todo from the same surprise");

    const stillUnlinked = body.reports.find((report) => report.id === wrongBundleReportId);
    expect(stillUnlinked?.todo).toBeNull();
  });

  test("GET /api/todos includes the origin-stamped todos", async () => {
    const response = await fetch(`${baseUrl}/api/todos`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      todos: ReadonlyArray<{ readonly title: string; readonly origin?: { readonly kind: string; readonly ref: string } }>;
    };
    const fromFailedReport = body.todos.find((todo) => todo.title === "Fix the missing package.json crash");
    expect(fromFailedReport?.origin).toEqual({ kind: "field-report", ref: failedReportId });
  });
});
