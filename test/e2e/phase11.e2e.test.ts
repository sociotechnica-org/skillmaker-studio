/**
 * End-to-end: publish targets + the Skillbook (data-model.md §2.9, §2.14,
 * plan.md Phase 11). Spawns the real `skillmaker` CLI's `start` command,
 * drives a bundle from `idea` through `published` over the same
 * `POST /api/events` contract Phase 4's e2e suite already exercises, records
 * a version, then runs the real `skillmaker publish` and
 * `skillmaker book build` CLI commands against a scratch workspace
 * configured with a `git-dir` and a `claude-marketplace` publish target.
 *
 * Covers: publish guard success once published + version recorded, manifest
 * contents on disk, `skill.published` journal events (one per target),
 * idempotent re-publish (`already_published`, no duplicate journal event),
 * and `skillmaker book build` producing an index page + a per-bundle page
 * with real bundle data baked in.
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
let port: number;
let baseUrl: string;

const runCli = (args: ReadonlyArray<string>, cwd: string = scratchDir) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

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

const requestAndApproveReview = async (slug: string, state: string): Promise<void> => {
  const requested = await postEvent("review.requested", { bundle: slug, state });
  expect(requested.status).toBe(200);
  const resolved = await postEvent("review.resolved", { bundle: slug, state, decision: "approve" });
  expect(resolved.status).toBe(200);
};

const journalEvents = (): ReadonlyArray<{ readonly type: string; readonly payload: Record<string, unknown> }> => {
  const journalPath = join(scratchDir, ".skillmaker", "events.jsonl");
  return readFileSync(journalPath, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { readonly type: string; readonly payload: Record<string, unknown> });
};

interface PublishJsonOutput {
  readonly status: string;
  readonly slug: string;
  readonly versionHash: string;
  readonly results: ReadonlyArray<{
    readonly target: string;
    readonly kind: string;
    readonly status: "published" | "already_published";
    readonly url?: string;
  }>;
}

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase11-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"], scratchDir).exitCode).toBe(0);
  expect(runCli(["new", "demo-skill", "--json"], scratchDir).exitCode).toBe(0);

  bundleDir = join(scratchDir, "skills", "demo-skill");
  writeFileSync(join(bundleDir, "design.md"), "# Demo Skill\n\nA demo skill for the Phase 11 e2e suite.\n");
  writeFileSync(
    join(bundleDir, "output", "SKILL.md"),
    "---\nname: demo-skill\ndescription: a demo skill shipped by the Phase 11 e2e suite.\n---\n\nDo the demo thing.\n",
  );

  // Configure publishTargets: one git-dir (a sibling scratch dir this test
  // owns) and one claude-marketplace target rooted at the workspace itself.
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    name: string;
    publishTargets: Array<{ id: string; kind: string; path?: string }>;
  };
  config.name = "Phase 11 Demo Studio";
  config.publishTargets = [
    { id: "repo", kind: "git-dir", path: join(scratchDir, "published-repo") },
    { id: "claude", kind: "claude-marketplace" },
  ];
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const server = await startE2eServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  serverProcess = server.process;
  port = server.port;
  baseUrl = server.baseUrl;

  // Walk idea -> published via the same review + gate contract Phase 4's
  // e2e suite exercises.
  for (const [from, to] of [
    ["idea", "researching"],
    ["researching", "drafting"],
    ["drafting", "evaluating"],
  ] as const) {
    await requestAndApproveReview("demo-skill", from);
    const advance = await postEvent("bundle.stage_changed", { bundle: "demo-skill", from, to });
    expect(advance.status).toBe(200);
  }

  await requestAndApproveReview("demo-skill", "evaluating");
  const gate = await postEvent("bundle.gate_decided", {
    bundle: "demo-skill",
    gate: "publish",
    decision: "approved",
    basis: "Phase 11 e2e: measured fixtures pass, manually verified",
  });
  expect(gate.status).toBe(200);
  const toPublished = await postEvent("bundle.stage_changed", {
    bundle: "demo-skill",
    from: "evaluating",
    to: "published",
  });
  expect(toPublished.status).toBe(200);
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

describe("skillmaker publish: guard + real target publishing", () => {
  test("publishing before a version is recorded is guard-rejected", () => {
    const result = runCli(["publish", "demo-skill", "--json"], scratchDir);
    expect(result.exitCode).toBe(1);
    const json = jsonFrom<{ status: string; reason: string }>(result);
    expect(json?.status).toBe("rejected");
    expect(json?.reason).toContain("never had a version recorded");
  });

  test("skillmaker version record succeeds now that the bundle is published", () => {
    const result = runCli(["version", "record", "demo-skill", "--label", "v1", "--json"], scratchDir);
    expect(result.exitCode).toBe(0);
    const json = jsonFrom<{ status: string; hash: string }>(result);
    expect(json?.status).toBe("appended");
    expect(json?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("skillmaker publish ships to both configured targets and records skill.published", () => {
    const result = runCli(["publish", "demo-skill", "--json"], scratchDir);
    expect(result.exitCode).toBe(0);
    const json = jsonFrom<PublishJsonOutput>(result);
    expect(json?.status).toBe("published");
    expect(json?.results).toHaveLength(2);
    expect(json?.results.every((entry) => entry.status === "published")).toBe(true);

    const published = journalEvents().filter((event) => event.type === "skill.published");
    expect(published).toHaveLength(2);
    expect(published.map((event) => event.payload.target).sort()).toEqual(["claude", "repo"]);
  });

  test("git-dir target: output/ was copied to <path>/demo-skill/", () => {
    const copiedSkill = join(scratchDir, "published-repo", "demo-skill", "SKILL.md");
    expect(existsSync(copiedSkill)).toBe(true);
    expect(readFileSync(copiedSkill, "utf8")).toContain("Do the demo thing.");
  });

  test("claude-marketplace target: .claude-plugin/marketplace.json gives demo-skill its own plugin entry (friction log finding #4)", () => {
    const manifestPath = join(scratchDir, ".claude-plugin", "marketplace.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name: string;
      owner: { name: string };
      plugins: ReadonlyArray<{ name: string; source: string; version: string }>;
    };
    expect(manifest.name).toBe("phase-11-demo-studio");
    expect(manifest.owner.name).toBe("Phase 11 Demo Studio");
    expect(manifest.plugins).toHaveLength(1);
    // Per-bundle plugin entry, named for the bundle -- not the old generic
    // shared "skills" plugin -- carrying the recorded label ("v1"), not a
    // bare hash.
    expect(manifest.plugins[0]?.name).toBe("demo-skill");
    expect(manifest.plugins[0]?.source).toBe("./skills/demo-skill/output");
    expect(manifest.plugins[0]?.version).toBe("v1");
  });

  test("claude-marketplace target: the storefront lives at .claude-plugin/MARKETPLACE.md, never the root README", () => {
    const storefrontPath = join(scratchDir, ".claude-plugin", "MARKETPLACE.md");
    expect(existsSync(storefrontPath)).toBe(true);
    const storefront = readFileSync(storefrontPath, "utf8");
    expect(storefront).toContain("### demo-skill");
    expect(storefront).toContain("v1");
    // The hand-authored project README must never be written by publish.
    expect(existsSync(join(scratchDir, "README.md"))).toBe(false);
  });

  test("re-publishing the same version to the same targets is idempotent: no new skill.published events", () => {
    const before = journalEvents().filter((event) => event.type === "skill.published").length;
    const result = runCli(["publish", "demo-skill", "--json"], scratchDir);
    expect(result.exitCode).toBe(0);
    const json = jsonFrom<PublishJsonOutput>(result);
    expect(json?.results.every((entry) => entry.status === "already_published")).toBe(true);

    const after = journalEvents().filter((event) => event.type === "skill.published").length;
    expect(after).toBe(before);
  });

  test("--target repo publishes to only the named target", () => {
    // Hand-edit the manifest to prove --target really did skip claude-marketplace:
    // record a fresh version, then publish only to "repo".
    writeFileSync(
      join(bundleDir, "output", "SKILL.md"),
      "---\nname: demo-skill\ndescription: a demo skill shipped by the Phase 11 e2e suite.\n---\n\nDo the updated demo thing.\n",
    );
    expect(runCli(["version", "record", "demo-skill", "--label", "v2", "--json"], scratchDir).exitCode).toBe(0);

    const result = runCli(["publish", "demo-skill", "--target", "repo", "--json"], scratchDir);
    expect(result.exitCode).toBe(0);
    const json = jsonFrom<PublishJsonOutput>(result);
    expect(json?.results).toHaveLength(1);
    expect(json?.results[0]?.target).toBe("repo");

    const copiedSkill = join(scratchDir, "published-repo", "demo-skill", "SKILL.md");
    expect(readFileSync(copiedSkill, "utf8")).toContain("Do the updated demo thing.");

    // The claude-marketplace manifest is unchanged (still the "v1" plugin
    // entry -- the "repo"-only publish never touched the claude target).
    const manifestPath = join(scratchDir, ".claude-plugin", "marketplace.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      plugins: ReadonlyArray<{ source: string; version: string }>;
    };
    expect(manifest.plugins[0]?.source).toBe("./skills/demo-skill/output");
    expect(manifest.plugins[0]?.version).toBe("v1");
  });

  test("an unknown --target id is a usage error", () => {
    const result = runCli(["publish", "demo-skill", "--target", "does-not-exist", "--json"], scratchDir);
    expect(result.exitCode).toBe(2);
  });
});

describe("skillmaker book build: the static Skillbook site", () => {
  test("builds index.html + a per-bundle page with real bundle data", () => {
    const outDir = join(scratchDir, "skillbook-out");
    const result = runCli(["book", "build", "--out", outDir, "--json"], scratchDir);
    expect(result.exitCode).toBe(0);
    const json = jsonFrom<{ status: string; outDir: string; pages: number }>(result);
    expect(json?.status).toBe("built");
    expect(json?.pages).toBe(2);

    const indexHtml = readFileSync(join(outDir, "index.html"), "utf8");
    expect(indexHtml).toContain("demo-skill");
    expect(indexHtml).toContain("published");

    const bundlePagePath = join(outDir, "demo-skill.html");
    expect(existsSync(bundlePagePath)).toBe(true);
    const bundleHtml = readFileSync(bundlePagePath, "utf8");
    expect(bundleHtml).toContain("Demo Skill");
    expect(bundleHtml).toContain("A demo skill for the Phase 11 e2e suite.");
    expect(bundleHtml).toContain("v2");
  });

  test("an empty workspace's Skillbook has an honest empty state", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase11-empty-"));
    try {
      Bun.spawnSync(["git", "init", "-q"], { cwd: emptyDir });
      Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: emptyDir });
      Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: emptyDir });
      expect(runCli(["init", "--json"], emptyDir).exitCode).toBe(0);

      const outDir = join(emptyDir, "skillbook-out");
      const result = runCli(["book", "build", "--out", outDir, "--json"], emptyDir);
      expect(result.exitCode).toBe(0);
      const json = jsonFrom<{ status: string; pages: number }>(result);
      expect(json?.pages).toBe(1);

      const indexHtml = readFileSync(join(outDir, "index.html"), "utf8");
      expect(indexHtml.toLowerCase()).toContain("no skill");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
