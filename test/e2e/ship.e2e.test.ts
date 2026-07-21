/**
 * End-to-end: `skillmaker ship` (issue #66, `Vision - Board Lab Ship
 * Receive.md` §HOW) -- the outbound half of the checkout/return-record
 * primitive. Spawns the real CLI against a scratch workspace, same harness
 * as `cli.e2e.test.ts`/`phase11.e2e.test.ts`: scaffold -> record a version
 * -> `ship` -> assert the journal line, the `--json` shape, and (via the
 * real `skillmaker start` server) that Ship's chapter/changelog surfaces
 * the shipment.
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

const journalEvents = (): ReadonlyArray<{ readonly type: string; readonly payload: Record<string, unknown>; readonly idempotencyKey?: string }> =>
  readFileSync(journalPath(), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

interface ShipJsonOutput {
  readonly status: string;
  readonly slug: string;
  readonly versionHash: string;
  readonly versionLabel: string | null;
  readonly destination: string;
  readonly purpose: string;
  readonly drift: string;
  readonly receiptCount: number;
}

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-ship-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "demo-skill", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "never-versioned", "--json"]).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "demo-skill");
  writeFileSync(join(bundleDir, "design.md"), "# Demo Skill\n\nA demo skill for the ship e2e suite.\n");
  writeFileSync(
    join(bundleDir, "output", "SKILL.md"),
    "---\nname: demo-skill\ndescription: a demo skill for the ship e2e suite.\n---\n\nDo the demo thing.\n",
  );
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

describe("skillmaker ship: validation", () => {
  test("missing <slug> is a usage error", () => {
    const result = runCli(["ship"]);
    expect(result.exitCode).toBe(2);
  });

  test("missing --to is a usage error", () => {
    const result = runCli(["ship", "demo-skill", "--purpose", "eval harness"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--to");
  });

  test("missing --purpose is a usage error", () => {
    const result = runCli(["ship", "demo-skill", "--to", "acme-fleet"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--purpose");
  });

  test("a bundle with no recorded version cannot be shipped", () => {
    const result = runCli([
      "ship",
      "never-versioned",
      "--to",
      "acme-fleet",
      "--purpose",
      "eval harness",
      "--json",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("never had a version recorded");

    const shipped = journalEvents().filter((event) => event.type === "skill.shipped");
    expect(shipped).toHaveLength(0);
  });

  test("an unknown bundle is rejected", () => {
    const result = runCli(["ship", "does-not-exist", "--to", "acme-fleet", "--purpose", "eval harness"]);
    expect(result.exitCode).toBe(1);
  });
});

describe("skillmaker ship: happy path", () => {
  test("recording a version first, then shipping, appends skill.shipped with a receipts snapshot", () => {
    const versionResult = runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]);
    expect(versionResult.exitCode).toBe(0);
    const versionJson = JSON.parse(versionResult.stdout) as { hash: string };

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
    const shipJson = JSON.parse(shipResult.stdout) as ShipJsonOutput;
    expect(shipJson.status).toBe("shipped");
    expect(shipJson.slug).toBe("demo-skill");
    expect(shipJson.versionHash).toBe(versionJson.hash);
    expect(shipJson.versionLabel).toBe("v1");
    expect(shipJson.destination).toBe("acme-agent-fleet");
    expect(shipJson.purpose).toBe("eval harness for team X");
    expect(shipJson.drift).toBe("in-sync");
    // No graded runs exist yet -- an honest empty receipts snapshot, not a
    // failure.
    expect(shipJson.receiptCount).toBe(0);

    const events = journalEvents();
    const shipped = events.filter((event) => event.type === "skill.shipped");
    expect(shipped).toHaveLength(1);
    expect(shipped[0]?.payload).toEqual({
      bundle: "demo-skill",
      versionHash: versionJson.hash,
      destination: "acme-agent-fleet",
      purpose: "eval harness for team X",
      receipts: [],
    });
    // No idempotency key -- re-shipping the same version/destination must be
    // a distinct event, unlike skill.published.
    expect(shipped[0]?.idempotencyKey).toBeUndefined();
  });

  test("re-shipping the same version to the same destination is a second, distinct journal event", () => {
    const before = journalEvents().filter((event) => event.type === "skill.shipped").length;
    const result = runCli([
      "ship",
      "demo-skill",
      "--to",
      "acme-agent-fleet",
      "--purpose",
      "eval harness for team X",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const after = journalEvents().filter((event) => event.type === "skill.shipped").length;
    expect(after).toBe(before + 1);
  });

  test("shipping again after a hand-edit warns about drift in text output without failing", () => {
    writeFileSync(
      join(bundleDir, "output", "SKILL.md"),
      "---\nname: demo-skill\ndescription: a demo skill for the ship e2e suite.\n---\n\nDo the updated thing.\n",
    );
    const result = runCli(["ship", "demo-skill", "--to", "acme-agent-fleet", "--purpose", "hotfix check"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("warning");
    expect(result.stdout).toContain("drift");
  });
});

describe("skillmaker ship: Ship surfaces the shipment", () => {
  beforeAll(async () => {
    const server = await startE2eServer({
      command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
      cwd: scratchDir,
    });
    serverProcess = server.process;
    baseUrl = server.baseUrl;
  }, 60000);

  interface SkillbookShipment {
    readonly at: string;
    readonly versionHash: string;
    readonly destination: string;
    readonly purpose: string;
    readonly receipts: ReadonlyArray<unknown>;
  }

  interface SkillbookBundle {
    readonly slug: string;
    readonly shipments: ReadonlyArray<SkillbookShipment>;
    readonly changelog: ReadonlyArray<{ readonly type: string; readonly summary: string }>;
  }

  test("GET /api/skillbook lists every shipment for the bundle, newest first, and a shipped changelog entry", async () => {
    const response = await fetch(`${baseUrl}/api/skillbook`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { bundles: ReadonlyArray<SkillbookBundle> };
    const demo = body.bundles.find((bundle) => bundle.slug === "demo-skill");
    expect(demo).toBeDefined();

    // Three ships happened in the "happy path" describe block above.
    expect(demo?.shipments).toHaveLength(3);
    expect(demo?.shipments.every((s) => s.destination === "acme-agent-fleet")).toBe(true);
    // Newest first.
    expect(demo?.shipments[0]?.purpose).toBe("hotfix check");

    const shippedEntries = demo?.changelog.filter((entry) => entry.type === "shipped") ?? [];
    expect(shippedEntries).toHaveLength(3);
    expect(shippedEntries[0]?.summary).toContain("acme-agent-fleet");

    const neverVersioned = body.bundles.find((bundle) => bundle.slug === "never-versioned");
    expect(neverVersioned?.shipments).toEqual([]);
  });
});
