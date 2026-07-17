/**
 * End-to-end: PR E's server payload additions (issue #109) -- the derived
 * data behind the skill card and Track. Spawns the real `skillmaker start`
 * server against a fresh workspace (the same harness as
 * `lab-two-modes.e2e.test.ts`/`route.e2e.test.ts`) and exercises:
 *
 *  - `GET /api/catalog`'s whereabouts fields: `lastShipment` (folded from
 *    `skill.shipped`, latest wins, `null` = never shipped) and
 *    `lastActivityAt` (recency of any attributable journal event) -- Track's
 *    Catalog rows and sort key.
 *  - `GET /api/bundles/:slug`'s `lineage`: the custody chain replayed from
 *    the journal (creation, version records, ship acts, receipt origin,
 *    retire) plus the fork family from adopt markers (`forkOf`/`forks`/
 *    `upstream`) after a real `route --as fork`.
 *  - `GET /api/intake`'s `salvaged`: the Archive drawer's full salvage
 *    fold, alongside the pre-existing `crates`/`recentlyRouted`.
 *  - The Feed side of the retire/salvage split: the acts (`bundle.archived`,
 *    the salvage `skill.routed`) appear in `GET /api/events` while the
 *    items appear in the drawer data above.
 *
 * The viewer-side halves (glance/chips, Track sorting, tab/route aliases)
 * are pure and unit-tested without React in `packages/viewer/src/app/
 * runtime/cardGlance.test.ts`, `trackSort.test.ts`, and `router.test.ts`
 * (no browser-level e2e harness exists in this repo).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd: scratchDir, stdout: "pipe", stderr: "pipe" });
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
  readonly archived: boolean;
  readonly lastShipment: { readonly destination: string; readonly versionHash: string; readonly at: string } | null;
  readonly lastActivityAt: string;
}

const getCatalog = async (): Promise<ReadonlyArray<CatalogRow>> => {
  const response = await fetch(`${baseUrl}/api/catalog`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { entries: ReadonlyArray<CatalogRow> };
  return body.entries;
};

interface LineagePayload {
  readonly custody: ReadonlyArray<{ readonly type: string; readonly payload: Record<string, unknown> }>;
  readonly forkOf: string | null;
  readonly forks: ReadonlyArray<string>;
  readonly upstream: { readonly source: string; readonly ref: string | null } | null;
}

const getBundleDetail = async (slug: string): Promise<{ lineage: LineagePayload }> => {
  const response = await fetch(`${baseUrl}/api/bundles/${slug}`);
  expect(response.status).toBe(200);
  return (await response.json()) as { lineage: LineagePayload };
};

interface SalvagedRow {
  readonly intake: string;
  readonly claimedName: string | null;
  readonly bundle: string | null;
  readonly reason: string;
  readonly at: string;
}

const getIntake = async (): Promise<{
  crates: ReadonlyArray<{ intake: string }>;
  salvaged: ReadonlyArray<SalvagedRow>;
}> => {
  const response = await fetch(`${baseUrl}/api/intake`);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    crates: ReadonlyArray<{ intake: string }>;
    salvaged: ReadonlyArray<SalvagedRow>;
  };
};

const receiveCrate = (relativeDir: string, skillMdContent: string, extraArgs: ReadonlyArray<string> = []) => {
  const incoming = join(scratchDir, "incoming", relativeDir);
  mkdirSync(incoming, { recursive: true });
  writeFileSync(join(incoming, "SKILL.md"), skillMdContent);
  const result = runCli(["receive", incoming, "--source", "test harness", ...extraArgs, "--json"]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as { intake: string; verdict: string };
};

const postEvent = async (type: string, payload: Record<string, unknown>): Promise<number> => {
  const response = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  return response.status;
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

  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-track-card-"));
  copyToolVersions(scratchDir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "gizmo", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "widget", "--json"]).exitCode).toBe(0);

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

describe("issue #109: GET /api/catalog whereabouts (lastShipment + lastActivityAt)", () => {
  test("a fresh bundle has never shipped and an honest recency timestamp", async () => {
    const entries = await getCatalog();
    for (const slug of ["gizmo", "widget"]) {
      const entry = entries.find((candidate) => candidate.slug === slug);
      expect(entry?.lastShipment).toBeNull();
      expect(typeof entry?.lastActivityAt).toBe("string");
      expect(entry?.lastActivityAt.length).toBeGreaterThan(0);
    }
  });

  test("shipping folds into lastShipment (latest wins) and re-stamps lastActivityAt; other bundles untouched", async () => {
    expect(runCli(["version", "record", "gizmo", "--label", "v1", "--json"]).exitCode).toBe(0);
    expect(
      runCli(["ship", "gizmo", "--to", "acme-fleet", "--purpose", "eval harness", "--json"]).exitCode,
    ).toBe(0);
    expect(
      runCli(["ship", "gizmo", "--to", "globex-lab", "--purpose", "second deployment", "--json"]).exitCode,
    ).toBe(0);

    const entries = await getCatalog();
    const gizmo = entries.find((candidate) => candidate.slug === "gizmo");
    expect(gizmo?.lastShipment?.destination).toBe("globex-lab");
    expect(gizmo?.lastShipment?.versionHash.startsWith("sha256:")).toBe(true);
    // Recency: the shipment is the most recent attributable event.
    expect(gizmo?.lastActivityAt).toBe(gizmo?.lastShipment?.at ?? "");
    expect(entries.find((candidate) => candidate.slug === "widget")?.lastShipment).toBeNull();
  });
});

describe("issue #109: GET /api/bundles/:slug lineage (custody chain + fork family)", () => {
  test("custody replays creation, version records, and ship acts in journal order; no fork facts invented", async () => {
    const { lineage } = await getBundleDetail("gizmo");
    expect(lineage.custody.map((event) => event.type)).toEqual([
      "bundle.created",
      "skill.version_recorded",
      "skill.shipped",
      "skill.shipped",
    ]);
    expect(lineage.forkOf).toBeNull();
    expect(lineage.forks).toEqual([]);
    expect(lineage.upstream).toBeNull();
  });

  let forkSlug: string;

  test("route --as fork stamps the marker: the child carries forkOf + upstream, the parent lists the fork", async () => {
    const received = receiveCrate(
      "diverged-gizmo",
      "---\nname: Diverged Gizmo\ndescription: a fork of gizmo for the track-card e2e suite.\n---\n\nDo the gizmo thing, differently.\n",
      ["--claimed-name", "Diverged Gizmo"],
    );
    const routed = runCli([
      "route",
      received.intake,
      "--as",
      "fork",
      "--parent",
      "gizmo",
      "--reason",
      "shared ancestry, diverged intent",
      "--json",
    ]);
    expect(routed.exitCode).toBe(0);
    const routedJson = JSON.parse(routed.stdout) as { slug: string | null };
    expect(routedJson.slug).not.toBeNull();
    forkSlug = routedJson.slug ?? "";

    const child = await getBundleDetail(forkSlug);
    expect(child.lineage.forkOf).toBe("gizmo");
    expect(child.lineage.upstream?.source).toBe("test harness");
    // The child's custody chain includes its receipt origin (skill.routed)
    // alongside creation + first recorded version.
    const childTypes = child.lineage.custody.map((event) => event.type);
    expect(childTypes).toContain("bundle.created");
    expect(childTypes).toContain("skill.routed");
    expect(childTypes).toContain("skill.version_recorded");

    const parent = await getBundleDetail("gizmo");
    expect(parent.lineage.forks).toContain(forkSlug);
  });
});

describe("issue #109: GET /api/intake salvaged (the Archive drawer's second population)", () => {
  let salvagedIntake: string;

  test("a salvage-routed crate leaves the queue and lands in the salvaged fold with its claims and reason", async () => {
    const received = receiveCrate(
      "smells-wrong",
      "---\nname: Smells Wrong Skill\ndescription: a crate destined for salvage.\n---\n\nDo something dubious.\n",
      ["--claimed-name", "Smells Wrong Skill"],
    );
    salvagedIntake = received.intake;

    const routed = runCli([
      "route",
      salvagedIntake,
      "--as",
      "salvage",
      "--reason",
      "hypothesis broken",
      "--json",
    ]);
    expect(routed.exitCode).toBe(0);

    const intake = await getIntake();
    expect(intake.crates.map((crate) => crate.intake)).not.toContain(salvagedIntake);
    const salvaged = intake.salvaged.find((crate) => crate.intake === salvagedIntake);
    expect(salvaged?.claimedName).toBe("Smells Wrong Skill");
    expect(salvaged?.reason).toBe("hypothesis broken");
    expect(salvaged?.bundle).toBeNull();
  });
});

describe("issue #109: the acts land in the Feed while the items land in the drawer", () => {
  test("retiring a bundle: the archived flag moves it to the drawer data, the act shows in GET /api/events", async () => {
    expect(await postEvent("bundle.archived", { bundle: "widget" })).toBe(200);

    const entries = await getCatalog();
    expect(entries.find((candidate) => candidate.slug === "widget")?.archived).toBe(true);

    const response = await fetch(`${baseUrl}/api/events?limit=50`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: ReadonlyArray<{ type: string; payload: Record<string, unknown> }>;
    };
    const types = body.events.map((event) => event.type);
    expect(types).toContain("bundle.archived");
    // The salvage act from the previous suite is journal history too.
    const salvageActs = body.events.filter(
      (event) => event.type === "skill.routed" && event.payload["disposition"] === "salvage",
    );
    expect(salvageActs.length).toBeGreaterThan(0);
  });
});
