/**
 * End-to-end: `skillmaker route` -- the Receiving Dock's five exit doors
 * (issue #91, `Mechanism - Receiving Dock.md` §HOW). Same harness as
 * `receive.e2e.test.ts`/`harvest.e2e.test.ts`: scaffold a couple of existing
 * bundles, receive a handful of crates against them, then route each crate
 * through a different door and assert the resulting fact on disk AND in the
 * journal. Circuits covered (issue #91's Testing section):
 *   - receive -> route new -> bundle exists at stage, with provenance.
 *   - receive conflicted -> route upgrade -> new version on the existing bundle.
 *   - route salvage -> fixture harvested from the crate carries intake provenance.
 *   - reindex replays all of the above cleanly.
 * Plus `return`/`fork` (the remaining two doors), idempotency, and
 * validation, and `GET /api/intake`'s undisposed queue + recently-routed
 * tail once crates start getting disposed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
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
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
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
  readonly intake: string;
  readonly verdict: string;
  readonly receivedDir: string;
}

const receiveCrate = (
  relativeDir: string,
  skillMdContent: string,
  extraArgs: ReadonlyArray<string> = [],
): ReceiveJsonOutput => {
  const incoming = join(scratchDir, "incoming", relativeDir);
  mkdirSync(incoming, { recursive: true });
  writeFileSync(join(incoming, "SKILL.md"), skillMdContent);
  const result = runCli(["receive", incoming, "--source", "test harness", ...extraArgs, "--json"]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as ReceiveJsonOutput;
};

interface RouteJsonOutput {
  readonly status: string;
  readonly intake: string;
  readonly disposition: string;
  readonly bundle: string | null;
  readonly slug: string | null;
  readonly parent: string | null;
  readonly versionHash: string | null;
}

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-route-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);

  for (const slug of ["demo-skill", "return-target-skill", "parent-skill"]) {
    expect(runCli(["new", slug, "--json"]).exitCode).toBe(0);
    const bundleDir = join(scratchDir, "skills", slug);
    writeFileSync(join(bundleDir, "design.md"), `# ${slug}\n\nA bundle for the route e2e suite.\n`);
    writeFileSync(
      join(bundleDir, "output", "SKILL.md"),
      `---\nname: ${slug}\ndescription: a bundle for the route e2e suite.\n---\n\nDo the ${slug} thing.\n`,
    );
    expect(runCli(["version", "record", slug, "--label", "v1", "--json"]).exitCode).toBe(0);
  }
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

describe("skillmaker route: validation", () => {
  test("missing <intake-id> is a usage error", () => {
    expect(runCli(["route"]).exitCode).toBe(2);
  });

  test("missing --as is a usage error", () => {
    const result = runCli(["route", "in-whatever", "--reason", "x"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--as");
  });

  test("an invalid --as is a usage error", () => {
    const result = runCli(["route", "in-whatever", "--as", "delete", "--reason", "x"]);
    expect(result.exitCode).toBe(2);
  });

  test("missing --reason is a usage error", () => {
    const result = runCli(["route", "in-whatever", "--as", "salvage"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--reason");
  });

  test("--as return without --bundle is a usage error", () => {
    const result = runCli(["route", "in-whatever", "--as", "return", "--reason", "x"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--bundle");
  });

  test("--as upgrade without --bundle is a usage error", () => {
    const result = runCli(["route", "in-whatever", "--as", "upgrade", "--reason", "x"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--bundle");
  });

  test("--as fork without --parent is a usage error", () => {
    const result = runCli(["route", "in-whatever", "--as", "fork", "--reason", "x"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--parent");
  });

  test("an unknown intake id is an honest error, not a crash", () => {
    const result = runCli(["route", "in-does-not-exist", "--as", "salvage", "--reason", "x"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no such intake");
  });
});

describe("skillmaker route: receive -> route new -> bundle exists at stage, with provenance", () => {
  let intake: string;

  test("receives a genuinely new crate (verdict: new)", () => {
    const received = receiveCrate(
      "new-arrival",
      "---\nname: New Arrival Skill\ndescription: shows up with no overlap at all.\n---\n\nDo a brand new thing.\n",
      ["--claimed-name", "New Arrival Skill", "--ref", "main"],
    );
    expect(received.verdict).toBe("new");
    intake = received.intake;
  });

  test("routes it as new, entering directly at 'drafting' (it arrived already working)", () => {
    const result = runCli([
      "route",
      intake,
      "--as",
      "new",
      "--stage",
      "drafting",
      "--reason",
      "arrived as a working draft, no overlap with anything we hold",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as RouteJsonOutput;
    expect(json.status).toBe("routed");
    expect(json.disposition).toBe("new");
    expect(json.slug).toBe("new-arrival-skill");
  });

  test("the bundle exists on disk with its marker's upstream provenance", () => {
    const bundleDir = join(scratchDir, "skills", "new-arrival-skill");
    expect(existsSync(join(bundleDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(bundleDir, "bundle.json"))).toBe(true);
    const marker = JSON.parse(readFileSync(join(bundleDir, ".skillmaker-adopt.json"), "utf8")) as {
      readonly upstream?: { readonly source: string; readonly ref?: string };
    };
    expect(marker.upstream?.source).toBe("test harness");
    expect(marker.upstream?.ref).toBe("main");
  });

  test("the crate directory is gone -- it moved, it wasn't copied", () => {
    expect(existsSync(join(scratchDir, "receiving", intake))).toBe(false);
  });

  test("skillmaker status reports the entry stage, honestly recorded as an override move", () => {
    const result = runCli(["status", "new-arrival-skill", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { stage: string };
    expect(json.stage).toBe("drafting");

    const stageChange = journalEvents().find(
      (event) => event.type === "bundle.stage_changed" && event.payload.bundle === "new-arrival-skill",
    );
    expect(stageChange?.payload.override).toBe(true);
    expect(stageChange?.payload.to).toBe("drafting");
  });
});

describe("skillmaker route: receive conflicted -> route upgrade -> new version on the existing bundle", () => {
  let intake: string;

  test("receives a same-claimed-name crate with different content (verdict: conflict)", () => {
    const received = receiveCrate(
      "demo-skill-evolved",
      "---\nname: demo-skill\ndescription: an evolved implementation.\n---\n\nDo the demo-skill thing, evolved.\n",
      ["--claimed-name", "demo-skill"],
    );
    expect(received.verdict).toBe("conflict");
    intake = received.intake;
  });

  test("routes it as upgrade against the existing bundle", () => {
    const result = runCli([
      "route",
      intake,
      "--as",
      "upgrade",
      "--bundle",
      "demo-skill",
      "--reason",
      "hypothesis evolved -- same skill, new approach",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as RouteJsonOutput;
    expect(json.disposition).toBe("upgrade");
    expect(json.bundle).toBe("demo-skill");
    expect(json.versionHash).not.toBeNull();
  });

  test("the bundle's output/ now carries the crate's content", () => {
    const content = readFileSync(join(scratchDir, "skills", "demo-skill", "output", "SKILL.md"), "utf8");
    expect(content).toContain("Do the demo-skill thing, evolved.");
  });

  test("a second skill.version_recorded event now exists for demo-skill", () => {
    const versions = journalEvents().filter(
      (event) => event.type === "skill.version_recorded" && event.payload.bundle === "demo-skill",
    );
    expect(versions).toHaveLength(2);
  });

  test("the crate itself is untouched -- upgrade never moves/deletes it", () => {
    const received = journalEvents().find(
      (event) => event.type === "skill.received" && event.payload.intake === intake,
    );
    expect(received).toBeDefined();
    expect(existsSync(join(scratchDir, "receiving", intake, "SKILL.md"))).toBe(true);
  });
});

describe("skillmaker route: route salvage -> fixture harvested from the crate carries intake provenance", () => {
  let intake: string;

  test("receives a crate, then routes it as salvage", () => {
    const received = receiveCrate(
      "broken-hypothesis",
      "---\nname: broken-hypothesis\n---\nDoesn't survive contact with real cases.\n",
    );
    intake = received.intake;

    const result = runCli([
      "route",
      intake,
      "--as",
      "salvage",
      "--reason",
      "hypothesis broken -- doesn't hold up under real use",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as RouteJsonOutput;
    expect(json.disposition).toBe("salvage");
    expect(json.bundle).toBeNull();
  });

  test("the crate stays at the dock, un-accessioned, retained as evidence", () => {
    expect(existsSync(join(scratchDir, "receiving", intake, "SKILL.md"))).toBe(true);
  });

  test("fixture harvest --from-intake mines the crate into a fixture carrying intake provenance", () => {
    const result = runCli([
      "fixture",
      "harvest",
      "demo-skill",
      "salvaged-case-1",
      "--from-intake",
      intake,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { source: { kind: string; intake: string } };
    expect(json.source).toEqual({ kind: "intake", intake });

    const caseJsonPath = join(scratchDir, "skills", "demo-skill", "evals", "fixtures", "salvaged-case-1", "case.json");
    const caseJson = JSON.parse(readFileSync(caseJsonPath, "utf8")) as { source: unknown };
    expect(caseJson.source).toEqual({ kind: "intake", intake });
  });

  test("todo add --from-intake mines the crate into a todo carrying intake provenance", () => {
    const result = runCli([
      "todo",
      "add",
      "Investigate the broken-hypothesis crate",
      "--from-intake",
      intake,
      "--bundle",
      "demo-skill",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { todo: { origin?: { kind: string; intakeId: string } } };
    expect(json.todo.origin).toEqual({ kind: "intake", intakeId: intake });
  });
});

describe("skillmaker route: return", () => {
  test("receiving an exact copy of the recorded content verdicts return, and routing it as return succeeds with no file movement", () => {
    const content = readFileSync(join(scratchDir, "skills", "return-target-skill", "output", "SKILL.md"), "utf8");
    const received = receiveCrate("returning-laptop", content, ["--claimed-name", "return-target-skill"]);
    expect(received.verdict).toBe("return");

    const result = runCli([
      "route",
      received.intake,
      "--as",
      "return",
      "--bundle",
      "return-target-skill",
      "--reason",
      "ours, coming home from a returning laptop",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as RouteJsonOutput;
    expect(json.disposition).toBe("return");
    expect(json.bundle).toBe("return-target-skill");
    expect(existsSync(join(scratchDir, "receiving", received.intake, "SKILL.md"))).toBe(true);
  });
});

describe("skillmaker route: fork", () => {
  test("mints a new bundle with the parent link recorded on its marker's forkOf", () => {
    const received = receiveCrate(
      "diverged-variant",
      "---\nname: Diverged Variant\ndescription: shares ancestry with parent-skill, diverges on X.\n---\n\nDo a different thing.\n",
      ["--claimed-name", "Diverged Variant"],
    );

    const result = runCli([
      "route",
      received.intake,
      "--as",
      "fork",
      "--parent",
      "parent-skill",
      "--reason",
      "shares ancestry with parent-skill, but diverges on X",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as RouteJsonOutput;
    expect(json.disposition).toBe("fork");
    expect(json.parent).toBe("parent-skill");
    expect(json.slug).toBe("diverged-variant");

    const marker = JSON.parse(
      readFileSync(join(scratchDir, "skills", "diverged-variant", ".skillmaker-adopt.json"), "utf8"),
    ) as { forkOf?: string };
    expect(marker.forkOf).toBe("parent-skill");
  });
});

describe("skillmaker route: idempotency", () => {
  test("re-routing the same intake with the same disposition is a no-op", () => {
    const received = receiveCrate("idempotent-crate", "---\nname: idempotent-crate\n---\nEvidence.\n");
    const first = runCli(["route", received.intake, "--as", "salvage", "--reason", "hypothesis broken", "--json"]);
    expect(first.exitCode).toBe(0);

    const second = runCli(["route", received.intake, "--as", "salvage", "--reason", "still broken", "--json"]);
    expect(second.exitCode).toBe(0);
    const json = JSON.parse(second.stdout) as { status: string };
    expect(json.status).toBe("already_routed");

    const routedEvents = journalEvents().filter(
      (event) => event.type === "skill.routed" && event.payload.intake === received.intake,
    );
    expect(routedEvents).toHaveLength(1);
  });

  test("re-routing the same intake with a DIFFERENT disposition is an honest conflict", () => {
    const received = receiveCrate("conflicting-redo", "---\nname: conflicting-redo\n---\nEvidence.\n");
    expect(runCli(["route", received.intake, "--as", "salvage", "--reason", "hypothesis broken", "--json"]).exitCode).toBe(
      0,
    );

    const result = runCli(["route", received.intake, "--as", "new", "--reason", "changed my mind", "--json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already routed");
  });
});

describe("skillmaker route: reindex replays all", () => {
  test("reindex succeeds with no warnings after every disposition above", () => {
    const result = runCli(["reindex", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout) as { warnings: ReadonlyArray<unknown> };
    expect(json.warnings).toEqual([]);
  });
});

describe("skillmaker route: GET /api/intake reflects disposition", () => {
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

  interface IntakeResponse {
    readonly crates: ReadonlyArray<{ readonly intake: string }>;
    readonly recentlyRouted: ReadonlyArray<{ readonly intake: string; readonly disposition: string; readonly bundle: string | null }>;
  }

  test("disposed crates leave the undisposed queue and show up in the recently-routed tail", async () => {
    const response = await fetch(`${baseUrl}/api/intake`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as IntakeResponse;

    // Every crate this suite received has been routed by now -- none remain undisposed.
    expect(body.crates).toHaveLength(0);
    expect(body.recentlyRouted.length).toBeGreaterThan(0);

    const upgraded = body.recentlyRouted.find((entry) => entry.disposition === "upgrade");
    expect(upgraded?.bundle).toBe("demo-skill");
  });
});
