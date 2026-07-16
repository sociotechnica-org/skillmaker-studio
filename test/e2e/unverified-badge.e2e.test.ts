/**
 * End-to-end: the Unverified badge (issue #93, `Mechanism - Receiving
 * Dock.md` §HOW, "The Unverified badge"). Derived, never stored: a bundle
 * that arrived via the Receiving Dock (`skill.routed`, an identity-granting
 * disposition) reads Unverified until our first graded measurement, ever,
 * at any recorded version. Circuits covered:
 *
 *   - a plain `new`-scaffolded bundle (never received) never badges,
 *     regardless of its measurement history.
 *   - receive -> route new -> the resulting bundle badges Unverified on
 *     both `GET /api/catalog` and the `recentlyRouted` tail.
 *   - run -> grade (pass) -> the badge clears on both surfaces.
 *   - a version bump (`route upgrade`) after the badge has cleared does NOT
 *     resurrect it -- the first measurement EVER clears, for good.
 *   - `route salvage` naming an existing (already-Unverified) bundle never
 *     clears or otherwise changes that bundle's badge -- salvage grants no
 *     identity.
 *
 * Uses the same mocked-ACP harness as phase9.e2e.test.ts (no live LLM
 * call, CI-safe).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerDist = join(repoRoot, "packages", "viewer", "dist");
const fakeAdapterSuccess = join(import.meta.dir, "fixtures", "fake-acp-success.cjs");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd: scratchDir, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

/** Scans stdout then stderr for the command's final JSON line (mirrors phase9.e2e.test.ts). */
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

const setProviderCommand = (command: ReadonlyArray<string>): void => {
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
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

interface ReceiveJsonOutput {
  readonly intake: string;
  readonly verdict: string;
}

const receiveCrate = (relativeDir: string, skillMdContent: string, extraArgs: ReadonlyArray<string> = []): ReceiveJsonOutput => {
  const incoming = join(scratchDir, "incoming", relativeDir);
  mkdirSync(incoming, { recursive: true });
  writeFileSync(join(incoming, "SKILL.md"), skillMdContent);
  const result = runCli(["receive", incoming, "--source", "test harness", ...extraArgs, "--json"]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as ReceiveJsonOutput;
};

interface RouteJsonOutput {
  readonly status: string;
  readonly disposition: string;
  readonly bundle: string | null;
  readonly slug: string | null;
}

const routeCrate = (intake: string, args: ReadonlyArray<string>): RouteJsonOutput => {
  const result = runCli(["route", intake, ...args, "--json"]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as RouteJsonOutput;
};

interface CatalogEntryJson {
  readonly slug: string;
  readonly unverified: boolean;
  readonly measuredFixtureCount: number;
}

const fetchCatalog = async (): Promise<ReadonlyArray<CatalogEntryJson>> => {
  const response = await fetch(`${baseUrl}/api/catalog`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { entries: ReadonlyArray<CatalogEntryJson> };
  return body.entries;
};

interface RecentlyRoutedJson {
  readonly intake: string;
  readonly disposition: string;
  readonly bundle: string | null;
  readonly unverified: boolean;
}

const fetchRecentlyRouted = async (): Promise<ReadonlyArray<RecentlyRoutedJson>> => {
  const response = await fetch(`${baseUrl}/api/intake`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { recentlyRouted: ReadonlyArray<RecentlyRoutedJson> };
  return body.recentlyRouted;
};

interface RunCliOutput {
  readonly status: "completed" | "failed" | "infra-error";
  readonly runId: string;
}

const cliRun = (slug: string, fixtureCase: string) => {
  const result = runCli(["run", slug, "--fixture", fixtureCase, "--provider", "claude-code", "--json"]);
  return jsonFrom<RunCliOutput>(result);
};

const cliGrade = (slug: string, runId: string, verdict: string) =>
  runCli(["grade", slug, runId, "--verdict", verdict, "--json"]);

beforeAll(async () => {
  if (!existsSync(join(viewerDist, "index.html"))) {
    const build = Bun.spawnSync(["bun", "run", "--filter", "@skillmaker/viewer", "build"], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (build.exitCode !== 0) {
      throw new Error("packages/viewer failed to build in test setup");
    }
  }

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-unverified-badge-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  setProviderCommand(["node", fakeAdapterSuccess]);

  const port = 24000 + Math.floor(Math.random() * 8000);
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

describe("a plain `new`-scaffolded bundle (never received) never badges Unverified", () => {
  test("skillmaker new never sets everReceived, so the catalog entry is never Unverified, even with zero measurements", async () => {
    expect(runCli(["new", "home-grown-skill", "--json"]).exitCode).toBe(0);

    const entries = await fetchCatalog();
    const entry = entries.find((candidate) => candidate.slug === "home-grown-skill");
    expect(entry).toBeDefined();
    expect(entry?.measuredFixtureCount).toBe(0);
    expect(entry?.unverified).toBe(false);
  });
});

describe("receive -> route new -> the resulting bundle badges Unverified", () => {
  let intake: string;

  test("receives and routes a genuinely new crate", () => {
    const received = receiveCrate(
      "arrived-skill",
      "---\nname: Arrived Skill\ndescription: shows up from outside.\n---\n\nDo the arrived thing.\n",
      ["--claimed-name", "Arrived Skill"],
    );
    expect(received.verdict).toBe("new");
    intake = received.intake;

    const routed = routeCrate(intake, ["--as", "new", "--reason", "no overlap with anything we hold"]);
    expect(routed.disposition).toBe("new");
    expect(routed.slug).toBe("arrived-skill");
  });

  test("GET /api/catalog shows the badge -- received, zero measurements ever", async () => {
    const entries = await fetchCatalog();
    const entry = entries.find((candidate) => candidate.slug === "arrived-skill");
    expect(entry).toBeDefined();
    expect(entry?.measuredFixtureCount).toBe(0);
    expect(entry?.unverified).toBe(true);
  });

  test("GET /api/intake's recentlyRouted tail shows the badge on this crate's row while it holds", async () => {
    const tail = await fetchRecentlyRouted();
    const row = tail.find((candidate) => candidate.intake === intake);
    expect(row).toBeDefined();
    expect(row?.bundle).toBe("arrived-skill");
    expect(row?.unverified).toBe(true);
  });

  test("run -> grade (pass) -> the badge clears on both the catalog and the recentlyRouted tail", async () => {
    const bundleDir = join(scratchDir, "skills", "arrived-skill");
    expect(runCli(["fixture", "add", "arrived-skill", "golden-basic", "--json"]).exitCode).toBe(0);
    writeFileSync(join(bundleDir, "evals", "fixtures", "golden-basic", "prompt.md"), "Do the thing.\n");

    const run = cliRun("arrived-skill", "golden-basic");
    expect(run?.status).toBe("completed");
    expect(run?.runId).toBeDefined();

    const graded = cliGrade("arrived-skill", String(run?.runId), "pass");
    expect(graded.exitCode).toBe(0);

    const entries = await fetchCatalog();
    const entry = entries.find((candidate) => candidate.slug === "arrived-skill");
    expect(entry?.measuredFixtureCount).toBe(1);
    expect(entry?.unverified).toBe(false);

    const tail = await fetchRecentlyRouted();
    const row = tail.find((candidate) => candidate.intake === intake);
    expect(row?.unverified).toBe(false);
  });

  test("a version bump (route upgrade from a second crate) does NOT resurrect the badge -- first measurement EVER clears, for good", async () => {
    const secondCrate = receiveCrate(
      "arrived-skill-v2",
      "---\nname: Arrived Skill\ndescription: an evolved implementation.\n---\n\nDo the arrived thing, evolved.\n",
      ["--claimed-name", "Arrived Skill"],
    );
    // Different content under the same claimed name -- verdict is conflict,
    // routed as upgrade against the existing bundle (same shape as
    // route.e2e.test.ts's upgrade circuit).
    expect(secondCrate.verdict).toBe("conflict");

    const routed = routeCrate(secondCrate.intake, [
      "--as",
      "upgrade",
      "--bundle",
      "arrived-skill",
      "--reason",
      "hypothesis evolved",
    ]);
    expect(routed.disposition).toBe("upgrade");
    expect(routed.bundle).toBe("arrived-skill");

    const entries = await fetchCatalog();
    const entry = entries.find((candidate) => candidate.slug === "arrived-skill");
    // The new version has no measurements of its OWN yet (an honest reset
    // for THAT display), but the badge itself stays cleared: the bundle's
    // full history (any version) still carries at least one graded
    // measurement.
    expect(entry?.unverified).toBe(false);
  });
});

describe("route salvage grants no identity: it never touches an existing bundle's own badge", () => {
  test("salvaging a crate against the already-cleared arrived-skill bundle leaves its badge alone", async () => {
    const salvaged = receiveCrate("broken-crate", "---\nname: broken-crate\n---\nDoesn't survive contact with real cases.\n");
    const routed = routeCrate(salvaged.intake, [
      "--as",
      "salvage",
      "--bundle",
      "arrived-skill",
      "--reason",
      "hypothesis broken -- doesn't hold up",
    ]);
    expect(routed.disposition).toBe("salvage");

    const entries = await fetchCatalog();
    const entry = entries.find((candidate) => candidate.slug === "arrived-skill");
    expect(entry?.unverified).toBe(false);

    const tail = await fetchRecentlyRouted();
    const row = tail.find((candidate) => candidate.intake === salvaged.intake);
    expect(row?.bundle).toBe("arrived-skill");
    // Salvage grants no identity: even though this row DOES name a bundle
    // (the one it defended), it never badges -- disposition disqualifies it
    // regardless of that bundle's own measurement history.
    expect(row?.unverified).toBe(false);
  });

  test("a fresh receive+salvage naming a NEVER-measured bundle also never badges the row -- salvage always disqualifies", async () => {
    expect(runCli(["new", "salvage-target", "--json"]).exitCode).toBe(0);
    const salvaged = receiveCrate("another-broken-crate", "---\nname: another-broken-crate\n---\nAlso broken.\n");
    const routed = routeCrate(salvaged.intake, [
      "--as",
      "salvage",
      "--bundle",
      "salvage-target",
      "--reason",
      "hypothesis broken",
    ]);
    expect(routed.disposition).toBe("salvage");

    const tail = await fetchRecentlyRouted();
    const row = tail.find((candidate) => candidate.intake === salvaged.intake);
    expect(row?.bundle).toBe("salvage-target");
    expect(row?.unverified).toBe(false);
  });
});
