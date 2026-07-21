/**
 * End-to-end: `skillmaker report` (issue #67, `Vision - Board Lab Ship
 * Receive.md` §HOW) -- the inbound half of the checkout/return-record
 * primitive Ship's `skillmaker ship` (#66) started. Same harness as
 * `ship.e2e.test.ts`: scaffold -> record a version -> `ship` -> `report` ->
 * assert the journal line, the `--json` shape, that Receive's data source
 * (`GET /api/field-reports`) shows it, and that the server-mediated
 * `POST /api/events` write path (Receive's paste form) also appends it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let bundleDir: string;
let versionHash: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

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
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey?: string;
}> =>
  readFileSync(journalPath(), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

interface ReportJsonOutput {
  readonly status: string;
  readonly slug: string;
  readonly outcome: string;
  readonly report: string;
  readonly versionHash: string | null;
  readonly destination: string | null;
}

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-report-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "demo-skill", "--json"]).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "demo-skill");
  writeFileSync(join(bundleDir, "design.md"), "# Demo Skill\n\nA demo skill for the report e2e suite.\n");
  writeFileSync(
    join(bundleDir, "output", "SKILL.md"),
    "---\nname: demo-skill\ndescription: a demo skill for the report e2e suite.\n---\n\nDo the demo thing.\n",
  );

  const versionResult = runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]);
  expect(versionResult.exitCode).toBe(0);
  versionHash = (JSON.parse(versionResult.stdout) as { hash: string }).hash;

  const shipResult = runCli([
    "ship",
    "demo-skill",
    "--to",
    "acme-agent-fleet",
    "--purpose",
    "eval harness for team X",
    "--json",
  ]);
  expect(shipResult.exitCode).toBe(0);
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

describe("skillmaker report: validation", () => {
  test("missing <slug> is a usage error", () => {
    const result = runCli(["report"]);
    expect(result.exitCode).toBe(2);
  });

  test("missing --outcome is a usage error", () => {
    const result = runCli(["report", "demo-skill", "--note", "worked great"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--outcome");
  });

  test("an invalid --outcome is a usage error", () => {
    const result = runCli(["report", "demo-skill", "--outcome", "mixed", "--note", "worked great"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--outcome");

    const reports = journalEvents().filter((event) => event.type === "skill.field_report");
    expect(reports).toHaveLength(0);
  });

  test("missing --note is a usage error", () => {
    const result = runCli(["report", "demo-skill", "--outcome", "worked"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--note");
  });

  test("an unknown bundle is rejected", () => {
    const result = runCli(["report", "does-not-exist", "--outcome", "worked", "--note", "worked great"]);
    expect(result.exitCode).toBe(1);
  });

  test("--version given but matching no recorded version is rejected", () => {
    const result = runCli([
      "report",
      "demo-skill",
      "--outcome",
      "worked",
      "--note",
      "worked great",
      "--version",
      "deadbeef",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--version");

    const reports = journalEvents().filter((event) => event.type === "skill.field_report");
    expect(reports).toHaveLength(0);
  });
});

describe("skillmaker report: happy path", () => {
  test("reporting with a known --version/--from appends skill.field_report tying back to the shipment", () => {
    const result = runCli([
      "report",
      "demo-skill",
      "--outcome",
      "worked",
      "--note",
      "Ran fine against three prod repos this week.",
      "--version",
      versionHash.slice(0, "sha256:".length + 8),
      "--from",
      "acme-agent-fleet",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as ReportJsonOutput;
    expect(json.status).toBe("reported");
    expect(json.slug).toBe("demo-skill");
    expect(json.outcome).toBe("worked");
    expect(json.versionHash).toBe(versionHash);
    expect(json.destination).toBe("acme-agent-fleet");

    const events = journalEvents();
    const reports = events.filter((event) => event.type === "skill.field_report");
    expect(reports).toHaveLength(1);
    expect(reports[0]?.payload).toEqual({
      bundle: "demo-skill",
      outcome: "worked",
      report: "Ran fine against three prod repos this week.",
      versionHash,
      destination: "acme-agent-fleet",
    });
    // No idempotency key -- two reports about the same bundle are two
    // distinct pieces of signal, never a duplicate to collapse.
    expect(reports[0]?.idempotencyKey).toBeUndefined();
  });

  test("reporting with neither --version nor --from omits both -- the reporter may not know either", () => {
    const result = runCli([
      "report",
      "demo-skill",
      "--outcome",
      "failed",
      "--note",
      "Broke on a repo with no package.json.",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as ReportJsonOutput;
    expect(json.versionHash).toBeNull();
    expect(json.destination).toBeNull();

    const events = journalEvents();
    const reports = events.filter((event) => event.type === "skill.field_report");
    expect(reports).toHaveLength(2);
    expect(reports[1]?.payload).toEqual({
      bundle: "demo-skill",
      outcome: "failed",
      report: "Broke on a repo with no package.json.",
    });
  });
});

describe("skillmaker report: Receive surfaces the report", () => {
  beforeAll(async () => {
    const server = await startE2eServer({
      command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
      cwd: scratchDir,
    });
    serverProcess = server.process;
    baseUrl = server.baseUrl;
  }, 60000);

  interface FieldReportView {
    readonly id: string;
    readonly bundle: string;
    readonly outcome: string;
    readonly report: string;
    readonly versionHash: string | null;
    readonly destination: string | null;
    readonly at: string;
  }

  test("GET /api/field-reports lists every report, newest first", async () => {
    const response = await fetch(`${baseUrl}/api/field-reports`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reports: ReadonlyArray<FieldReportView> };
    // Two reports were appended in the "happy path" describe block above.
    expect(body.reports).toHaveLength(2);
    // Newest first.
    expect(body.reports[0]?.outcome).toBe("failed");
    expect(body.reports[0]?.versionHash).toBeNull();
    expect(body.reports[1]?.outcome).toBe("worked");
    expect(body.reports[1]?.versionHash).toBe(versionHash);
  });

  test("Ship's changelog picks up a reported entry for the bundle", async () => {
    const response = await fetch(`${baseUrl}/api/skillbook`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      bundles: ReadonlyArray<{
        readonly slug: string;
        readonly changelog: ReadonlyArray<{ readonly type: string; readonly summary: string }>;
      }>;
    };
    const demo = body.bundles.find((bundle) => bundle.slug === "demo-skill");
    const reported = demo?.changelog.filter((entry) => entry.type === "reported") ?? [];
    expect(reported).toHaveLength(2);
  });

  test("POST /api/events accepts skill.field_report -- Receive's paste form write path", async () => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "skill.field_report",
        payload: { bundle: "demo-skill", outcome: "surprise", report: "Used a tool we didn't expect." },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; event: { type: string } };
    expect(body.status).toBe("appended");
    expect(body.event.type).toBe("skill.field_report");

    const reportsResponse = await fetch(`${baseUrl}/api/field-reports`);
    const reportsBody = (await reportsResponse.json()) as { reports: ReadonlyArray<FieldReportView> };
    expect(reportsBody.reports).toHaveLength(3);
    expect(reportsBody.reports[0]?.outcome).toBe("surprise");
  });

  test("POST /api/events rejects an invalid outcome for skill.field_report", async () => {
    const response = await fetch(`${baseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "skill.field_report",
        payload: { bundle: "demo-skill", outcome: "mixed", report: "..." },
      }),
    });
    expect(response.status).toBe(400);
  });
});
