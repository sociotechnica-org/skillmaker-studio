/**
 * End-to-end: `skillmaker receive` (issue #90, `Mechanism - Receiving Dock.md`
 * §HOW) -- the dock's CLI door. Same harness as `ship.e2e.test.ts`/
 * `report.e2e.test.ts`: scaffold -> record a version -> `receive` a copy
 * whose content matches the recorded version (verdict `return`) and a
 * same-claimed-name crate whose content differs (verdict `conflict`) ->
 * assert the journal line, the `--json` shape, `GET /api/intake` (oldest
 * first, both crates), and that `reindex` replays the new event type
 * cleanly.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let bundleDir: string;
let versionHash: string;
let skillMdContent: string;
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

interface ReceiveJsonOutput {
  readonly status: string;
  readonly intake: string;
  readonly verdict: string;
  readonly receivedDir: string;
}

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-receive-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  // `new` title-cases the slug into "Demo Skill" for bundle.json's `name` --
  // that's what a `--claimed-name` conflict match compares against.
  expect(runCli(["new", "demo-skill", "--json"]).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "demo-skill");
  writeFileSync(join(bundleDir, "design.md"), "# Demo Skill\n\nA demo skill for the receive e2e suite.\n");
  skillMdContent =
    "---\nname: demo-skill\ndescription: a demo skill for the receive e2e suite.\n---\n\nDo the demo thing.\n";
  writeFileSync(join(bundleDir, "output", "SKILL.md"), skillMdContent);

  const versionResult = runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]);
  expect(versionResult.exitCode).toBe(0);
  versionHash = (JSON.parse(versionResult.stdout) as { hash: string }).hash;
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

describe("skillmaker receive: validation", () => {
  test("missing <path> is a usage error", () => {
    const result = runCli(["receive"]);
    expect(result.exitCode).toBe(2);
  });

  test("an invalid --rights is a usage error", () => {
    const incoming = join(scratchDir, "incoming-bad-rights");
    mkdirSync(incoming, { recursive: true });
    writeFileSync(join(incoming, "SKILL.md"), "---\nname: whatever\n---\nDo the thing.\n");
    const result = runCli(["receive", incoming, "--rights", "maybe"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--rights");

    const received = journalEvents().filter((event) => event.type === "skill.received");
    expect(received).toHaveLength(0);
  });

  test("a missing path is an honest error, not a crash", () => {
    const result = runCli(["receive", join(scratchDir, "does-not-exist")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("does not exist");
  });

  test("a path that is a file, not a directory, is rejected", () => {
    const filePath = join(scratchDir, "not-a-directory.txt");
    writeFileSync(filePath, "just a file");
    const result = runCli(["receive", filePath]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not a directory");
  });

  test("a directory with no SKILL.md is rejected -- the dock takes skills, not arbitrary directories", () => {
    const notASkill = join(scratchDir, "not-a-skill");
    mkdirSync(notASkill, { recursive: true });
    writeFileSync(join(notASkill, "README.md"), "just a readme");
    const result = runCli(["receive", notASkill]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("SKILL.md");

    const received = journalEvents().filter((event) => event.type === "skill.received");
    expect(received).toHaveLength(0);
  });
});

describe("skillmaker receive: dock verdicts", () => {
  test("receiving a copy whose content matches a recorded version verdicts \"return\", and never touches the source", () => {
    const incoming = join(scratchDir, "incoming", "demo-skill-returning");
    mkdirSync(incoming, { recursive: true });
    writeFileSync(join(incoming, "SKILL.md"), skillMdContent);

    const result = runCli([
      "receive",
      incoming,
      "--source",
      "a returning laptop",
      "--claimed-name",
      "Demo Skill",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as ReceiveJsonOutput;
    expect(json.status).toBe("received");
    expect(json.intake).toMatch(/^in-/);
    expect(json.verdict).toBe("return");

    // The maker's source directory is untouched -- copied, never moved.
    expect(existsSync(join(incoming, "SKILL.md"))).toBe(true);
    expect(existsSync(join(json.receivedDir, "SKILL.md"))).toBe(true);
    expect(readFileSync(join(json.receivedDir, "SKILL.md"), "utf8")).toBe(skillMdContent);

    const events = journalEvents();
    const received = events.filter((event) => event.type === "skill.received");
    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toEqual({
      intake: json.intake,
      source: "a returning laptop",
      claimedName: "Demo Skill",
    });
    // No bundle field -- a crate has no identity yet.
    expect(received[0]?.payload.bundle).toBeUndefined();
    // No idempotency key -- two receives are two distinct dock arrivals.
    expect(received[0]?.idempotencyKey).toBeUndefined();
  });

  test("receiving a same-claimed-name crate with different content verdicts \"conflict\"", () => {
    const incoming = join(scratchDir, "incoming", "demo-skill-stranger");
    mkdirSync(incoming, { recursive: true });
    writeFileSync(
      join(incoming, "SKILL.md"),
      "---\nname: demo-skill\ndescription: a completely different implementation.\n---\n\nDo a different thing entirely.\n",
    );

    const result = runCli([
      "receive",
      incoming,
      "--source",
      "an external contributor",
      "--claimed-name",
      "demo-skill",
      "--rights",
      "unclear",
      "--notes",
      "arrived via a shared drive link",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as ReceiveJsonOutput;
    expect(json.verdict).toBe("conflict");

    const events = journalEvents();
    const received = events.filter((event) => event.type === "skill.received");
    expect(received).toHaveLength(2);
    expect(received[1]?.payload).toEqual({
      intake: json.intake,
      source: "an external contributor",
      claimedName: "demo-skill",
      rights: "unclear",
      notes: "arrived via a shared drive link",
    });
  });

  test("receiving a crate with no claims at all verdicts \"new\", never a special no-claims case", () => {
    const incoming = join(scratchDir, "incoming", "totally-unrelated");
    mkdirSync(incoming, { recursive: true });
    writeFileSync(join(incoming, "SKILL.md"), "---\nname: totally-unrelated\n---\nDo an unrelated thing.\n");

    const result = runCli(["receive", incoming, "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as ReceiveJsonOutput;
    expect(json.verdict).toBe("new");

    // `--source` defaults to the given <path> verbatim when omitted.
    const events = journalEvents();
    const received = events.filter((event) => event.type === "skill.received");
    expect(received).toHaveLength(3);
    expect(received[2]?.payload.source).toBe(incoming);
  });

  test("reindex replays the new skill.received event type cleanly", () => {
    const result = runCli(["reindex", "--json"]);
    expect(result.exitCode).toBe(0);
  });
});

describe("skillmaker receive: Receive's intake queue surfaces the dock", () => {
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

  interface IntakeCrateView {
    readonly intake: string;
    readonly source: string;
    readonly claimedName: string | null;
    readonly rights: string | null;
    readonly verdict: string;
    readonly at: string;
  }

  test("GET /api/intake lists every undisposed crate, oldest first, each with a freshly derived verdict", async () => {
    const response = await fetch(`${baseUrl}/api/intake`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { crates: ReadonlyArray<IntakeCrateView> };

    // Three crates were received in the "dock verdicts" describe block above.
    expect(body.crates).toHaveLength(3);
    // Oldest first -- the dock must not become a shelf.
    expect(body.crates[0]?.verdict).toBe("return");
    expect(body.crates[0]?.claimedName).toBe("Demo Skill");
    expect(body.crates[1]?.verdict).toBe("conflict");
    expect(body.crates[1]?.rights).toBe("unclear");
    expect(body.crates[2]?.verdict).toBe("new");
    expect(body.crates[2]?.claimedName).toBeNull();

    // Every timestamp is non-decreasing in this same order.
    const timestamps = body.crates.map((crate) => new Date(crate.at).getTime());
    expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1] ?? Number.POSITIVE_INFINITY);
    expect(timestamps[1]).toBeLessThanOrEqual(timestamps[2] ?? Number.POSITIVE_INFINITY);
  });
});
