/**
 * End-to-end: `skillmaker fixture harvest` (issue #68, `Vision - Board Lab
 * Ship Receive.md` §WHY: "a skill that fails in production *is* a new
 * fixture") -- the return channel `report.e2e.test.ts` (#67) stopped short
 * of. Same harness as `report.e2e.test.ts`: scaffold -> record a version ->
 * `ship` -> `report` -> `fixture harvest` -> assert `case.json` carries
 * provenance, `prompt.md` carries the report text verbatim, `reindex` counts
 * the new fixture, and `GET /api/field-reports` marks the report harvested.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let bundleDir: string;
let otherBundleDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

let failedReportId: string;
let unharvestedReportId: string;
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

interface HarvestJsonOutput {
  readonly status: string;
  readonly bundle: string;
  readonly case: string;
  readonly class: string;
  readonly source: {
    readonly kind: string;
    readonly eventId: string;
    readonly destination?: string;
  };
}

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-harvest-"));
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

  bundleDir = join(scratchDir, "skills", "demo-skill");
  otherBundleDir = join(scratchDir, "skills", "other-skill");
  for (const dir of [bundleDir, otherBundleDir]) {
    writeFileSync(join(dir, "design.md"), "# Demo Skill\n\nA demo skill for the harvest e2e suite.\n");
    writeFileSync(
      join(dir, "output", "SKILL.md"),
      "---\nname: demo-skill\ndescription: a demo skill for the harvest e2e suite.\n---\n\nDo the demo thing.\n",
    );
  }

  expect(runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]).exitCode).toBe(0);
  expect(
    runCli(["ship", "demo-skill", "--to", "acme-agent-fleet", "--purpose", "eval harness for team X", "--json"])
      .exitCode,
  ).toBe(0);

  // A non-field-report event to prove `fixture harvest` rejects it (a
  // skill.version_recorded event, already on the journal from above).
  notAReportEventId = latestEventId("skill.version_recorded", "demo-skill");

  // A field report for a DIFFERENT bundle, to prove `fixture harvest` on
  // "demo-skill" rejects a report that names "other-skill".
  expect(
    runCli(["report", "other-skill", "--outcome", "failed", "--note", "Broke on other-skill.", "--json"])
      .exitCode,
  ).toBe(0);
  wrongBundleReportId = latestEventId("skill.field_report", "other-skill");

  // The report this suite actually harvests.
  const reportResult = runCli([
    "report",
    "demo-skill",
    "--outcome",
    "failed",
    "--note",
    "Broke on a repo with no package.json.",
    "--from",
    "acme-agent-fleet",
    "--json",
  ]);
  expect(reportResult.exitCode).toBe(0);
  failedReportId = latestEventId("skill.field_report", "demo-skill");

  // A second field report on the same bundle, deliberately left
  // unharvested -- proves the Receive list can tell the two apart.
  expect(
    runCli(["report", "demo-skill", "--outcome", "surprise", "--note", "Used an unexpected tool.", "--json"])
      .exitCode,
  ).toBe(0);
  unharvestedReportId = latestEventId("skill.field_report", "demo-skill");
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

describe("skillmaker fixture harvest: validation", () => {
  test("missing <slug> <case> is a usage error", () => {
    const result = runCli(["fixture", "harvest"]);
    expect(result.exitCode).toBe(2);
  });

  test("missing --from-report is a usage error", () => {
    const result = runCli(["fixture", "harvest", "demo-skill", "hard-case-1"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--from-report");
  });

  test("an invalid --class is a usage error", () => {
    const result = runCli([
      "fixture",
      "harvest",
      "demo-skill",
      "hard-case-1",
      "--from-report",
      failedReportId,
      "--class",
      "not-a-class",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--class");
  });

  test("an unknown bundle is rejected", () => {
    const result = runCli([
      "fixture",
      "harvest",
      "does-not-exist",
      "hard-case-1",
      "--from-report",
      failedReportId,
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("an unknown event id is rejected honestly", () => {
    const result = runCli([
      "fixture",
      "harvest",
      "demo-skill",
      "hard-case-1",
      "--from-report",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no such event");
  });

  test("an event that isn't a skill.field_report is rejected honestly", () => {
    const result = runCli([
      "fixture",
      "harvest",
      "demo-skill",
      "hard-case-1",
      "--from-report",
      notAReportEventId,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a skill.field_report");
  });

  test("a field report for a different bundle is rejected honestly", () => {
    const result = runCli([
      "fixture",
      "harvest",
      "demo-skill",
      "hard-case-1",
      "--from-report",
      wrongBundleReportId,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("other-skill");
  });
});

describe("skillmaker fixture harvest: happy path", () => {
  test("harvests the report into a fixture, defaulting to class hard-case", () => {
    const result = runCli([
      "fixture",
      "harvest",
      "demo-skill",
      "hard-case-1",
      "--from-report",
      failedReportId,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as HarvestJsonOutput;
    expect(json.status).toBe("harvested");
    expect(json.bundle).toBe("demo-skill");
    expect(json.case).toBe("hard-case-1");
    expect(json.class).toBe("hard-case");
    expect(json.source).toEqual({
      kind: "field-report",
      eventId: failedReportId,
      destination: "acme-agent-fleet",
    });
  });

  test("case.json carries provenance, schemaVersion, and empty risks", () => {
    const caseJsonPath = join(bundleDir, "evals", "fixtures", "hard-case-1", "case.json");
    const caseJson = JSON.parse(readFileSync(caseJsonPath, "utf8")) as {
      readonly schemaVersion: number;
      readonly case: string;
      readonly class: string;
      readonly risks: ReadonlyArray<string>;
      readonly source: { readonly kind: string; readonly eventId: string; readonly destination?: string };
    };
    expect(caseJson.schemaVersion).toBe(1);
    expect(caseJson.case).toBe("hard-case-1");
    expect(caseJson.class).toBe("hard-case");
    expect(caseJson.risks).toEqual([]);
    expect(caseJson.source).toEqual({
      kind: "field-report",
      eventId: failedReportId,
      destination: "acme-agent-fleet",
    });
  });

  test("prompt.md carries the report's prose verbatim", () => {
    const promptPath = join(bundleDir, "evals", "fixtures", "hard-case-1", "prompt.md");
    expect(readFileSync(promptPath, "utf8")).toBe("Broke on a repo with no package.json.\n");
  });

  test("files/.gitkeep and expected/answer-key.md are scaffolded, same as fixture add", () => {
    const caseDir = join(bundleDir, "evals", "fixtures", "hard-case-1");
    expect(existsSync(join(caseDir, "files", ".gitkeep"))).toBe(true);
    expect(existsSync(join(caseDir, "expected", "answer-key.md"))).toBe(true);
  });

  test("harvesting never appends to the journal -- fixtures are files, not events", () => {
    const before = journalEvents().length;
    // Harvesting the SAME report into a differently-named case is still a
    // pure file write.
    const result = runCli([
      "fixture",
      "harvest",
      "demo-skill",
      "hard-case-1-copy",
      "--from-report",
      failedReportId,
      "--class",
      "trigger",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    expect(journalEvents().length).toBe(before);
  });

  test("re-harvesting into the same case name is a collision, honestly rejected", () => {
    const result = runCli([
      "fixture",
      "harvest",
      "demo-skill",
      "hard-case-1",
      "--from-report",
      failedReportId,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("already exists");
  });
});

describe("skillmaker fixture harvest: reindex + server surfaces the fixture", () => {
  test("reindex counts the harvested fixtures, no warnings", () => {
    const result = runCli(["reindex", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { warnings: ReadonlyArray<unknown> };
    expect(json.warnings).toEqual([]);
  });

  test("skillmaker status reports the harvested fixture count", () => {
    const result = runCli(["status", "demo-skill", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { fixtureCount: number };
    // hard-case-1 + hard-case-1-copy.
    expect(json.fixtureCount).toBe(2);
  });

  beforeAll(async () => {
    const port = 24000 + Math.floor(Math.random() * 8000);
    baseUrl = `http://localhost:${port}`;
    serverProcess = Bun.spawn(["bun", cliEntry, "start", "--port", String(port), "--no-open"], {
      cwd: scratchDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await waitForHealth(baseUrl, 30000);
  }, 60000);

  interface FixtureView {
    readonly caseName: string;
    readonly class: string;
    readonly source?: { readonly kind: string; readonly eventId: string; readonly destination?: string };
  }

  test("GET /api/bundles/:slug lists the harvested fixture with its provenance", async () => {
    const response = await fetch(`${baseUrl}/api/bundles/demo-skill`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { fixtures: ReadonlyArray<FixtureView> };
    const harvested = body.fixtures.find((fixture) => fixture.caseName === "hard-case-1");
    expect(harvested?.class).toBe("hard-case");
    expect(harvested?.source).toEqual({
      kind: "field-report",
      eventId: failedReportId,
      destination: "acme-agent-fleet",
    });
  });

  interface FieldReportView {
    readonly id: string;
    readonly bundle: string;
    readonly fixtureCase: string | null;
  }

  test("GET /api/field-reports marks the harvested report and leaves the unharvested one null", async () => {
    const response = await fetch(`${baseUrl}/api/field-reports`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { reports: ReadonlyArray<FieldReportView> };

    const harvested = body.reports.find((report) => report.id === failedReportId);
    expect(harvested?.fixtureCase).toBe("hard-case-1");

    const unharvested = body.reports.find((report) => report.id === unharvestedReportId);
    expect(unharvested?.fixtureCase).toBeNull();

    const otherBundleReport = body.reports.find((report) => report.id === wrongBundleReportId);
    expect(otherBundleReport?.fixtureCase).toBeNull();
  });

  test("GET /api/bundles reports a fixture count of 2 for demo-skill", async () => {
    const response = await fetch(`${baseUrl}/api/bundles`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { fixtureCounts: Readonly<Record<string, number>> };
    expect(body.fixtureCounts["demo-skill"]).toBe(2);
  });
});
