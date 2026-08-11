/**
 * End-to-end: the install door (director rulings 2026-08-03,
 * core/InstallPublish.ts). Spawns the real `skillmaker` CLI + server
 * against a scratch workspace with a TEMP claude home (`CLAUDE_CONFIG_DIR`
 * -- the operator's real `~/.claude` is never touched), drives a bundle
 * idea -> published, records versions, then exercises:
 *
 * - CLI: bare publish with no remembered target is a clear rejection;
 *   `--to user` installs the stamped output into
 *   `$CLAUDE_CONFIG_DIR/skills/<slug>/`, journals `skill.published` with
 *   the evidence line, and remembers the choice in bundle.json; a bare
 *   re-publish rides the memory and is a true no-op; `--version` reverts
 *   from the snapshot store and journals a REAL act.
 * - Server: `POST /api/bundles/:slug/publish {to: "project"}` installs
 *   into the workspace's `.claude/skills/<slug>/` via the same core
 *   function; `GET /api/bundles/:slug` carries the `publish` block
 *   (remembered audiences, per-target last-publish + installed drift).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let claudeHome: string;
let bundleDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let projectUrl: string;
let v1Hash: string;
let v2Hash: string;

const SKILL_V1 =
  "---\nname: demo-skill\ndescription: a demo skill shipped by the publish-door e2e suite.\n---\n\nDo the demo thing.\n";
const SKILL_V2 = SKILL_V1.replace("Do the demo thing.", "Do the NEW demo thing.");

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeHome },
  });
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
): Promise<{ status: number }> => {
  const response = await fetch(`${projectUrl}/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
  await response.json();
  return { status: response.status };
};

const journalEvents = (): ReadonlyArray<{ readonly type: string; readonly payload: Record<string, unknown> }> =>
  readFileSync(join(scratchDir, ".skillmaker", "events.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { readonly type: string; readonly payload: Record<string, unknown> });

const installPublishEvents = () =>
  journalEvents().filter(
    (event) => event.type === "skill.published" && (event.payload.target === "user" || event.payload.target === "project"),
  );

interface InstallPublishJson {
  readonly status: string;
  readonly slug?: string;
  readonly reason?: string;
  readonly versionHash?: string;
  readonly evidence?: string;
  readonly remembered?: ReadonlyArray<string>;
  readonly results?: ReadonlyArray<{ readonly target: string; readonly path: string; readonly status: string }>;
}

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-publish-door-"));
  claudeHome = mkdtempSync(join(tmpdir(), "skillmaker-e2e-claude-home-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  // Birth intent up front: the idea -> researching gate (THE MERGE ruled
  // table) requires a non-empty oneLiner.
  expect(
    runCli(["new", "demo-skill", "--one-liner", "A demo skill for the publish-door e2e suite.", "--json"])
      .exitCode,
  ).toBe(0);

  bundleDir = join(scratchDir, "skills", "demo-skill");
  writeFileSync(join(bundleDir, "design.md"), "# Demo Skill\n\nA demo skill for the publish-door e2e suite.\n");
  writeFileSync(join(bundleDir, "output", "SKILL.md"), SKILL_V1);
  writeFileSync(join(bundleDir, "output", "reference.md"), "sibling file\n");

  const server = await startE2eRegistryServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
    env: { CLAUDE_CONFIG_DIR: claudeHome },
  });
  serverProcess = server.process;
  projectUrl = server.projectUrls[0] as string;

  // Walk idea -> published via the same review + gate contract Phase 4's
  // e2e suite exercises.
  for (const [from, to] of [
    ["idea", "researching"],
    ["researching", "drafting"],
    ["drafting", "evaluating"],
  ] as const) {
    expect((await postEvent("review.requested", { bundle: "demo-skill", state: from })).status).toBe(200);
    expect(
      (await postEvent("review.resolved", { bundle: "demo-skill", state: from, decision: "approve" })).status,
    ).toBe(200);
    expect((await postEvent("bundle.stage_changed", { bundle: "demo-skill", from, to })).status).toBe(200);
  }
  expect((await postEvent("review.requested", { bundle: "demo-skill", state: "evaluating" })).status).toBe(200);
  expect(
    (await postEvent("review.resolved", { bundle: "demo-skill", state: "evaluating", decision: "approve" })).status,
  ).toBe(200);
  expect(
    (
      await postEvent("bundle.gate_decided", {
        bundle: "demo-skill",
        gate: "publish",
        decision: "approved",
        basis: "publish-door e2e: manually verified",
      })
    ).status,
  ).toBe(200);
  expect(
    (await postEvent("bundle.stage_changed", { bundle: "demo-skill", from: "evaluating", to: "published" })).status,
  ).toBe(200);

  const recorded = runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]);
  expect(recorded.exitCode).toBe(0);
  v1Hash = jsonFrom<{ hash: string }>(recorded)?.hash as string;
  expect(v1Hash).toMatch(/^sha256:[0-9a-f]{64}$/);
}, 60000);

afterAll(async () => {
  if (serverProcess !== undefined) {
    serverProcess.kill("SIGTERM");
    await serverProcess.exited;
  }
  for (const dir of [scratchDir, claudeHome]) {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("CLI install door", () => {
  test("bare publish with no remembered target is rejected with the two-audience guidance", () => {
    const result = runCli(["publish", "demo-skill", "--json"]);
    expect(result.exitCode).toBe(1);
    const json = jsonFrom<InstallPublishJson>(result);
    expect(json?.status).toBe("rejected");
    expect(json?.reason).toContain("--to user");
    expect(json?.reason).toContain("--to project");
  });

  test("--to user installs the stamped output into $CLAUDE_CONFIG_DIR/skills and remembers the choice", () => {
    const result = runCli(["publish", "demo-skill", "--to", "user", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = jsonFrom<InstallPublishJson>(result);
    expect(json?.status).toBe("published");
    expect(json?.versionHash).toBe(v1Hash);
    expect(json?.evidence).toMatch(/claims measured$/);
    expect(json?.remembered).toEqual(["user"]);
    expect(json?.results?.[0]?.target).toBe("user");
    expect(json?.results?.[0]?.status).toBe("published");

    const installedDir = join(claudeHome, "skills", "demo-skill");
    expect(json?.results?.[0]?.path).toBe(installedDir);
    const installed = readFileSync(join(installedDir, "SKILL.md"), "utf8");
    // Frontmatter stays first (harness loaders require it); the stamp sits
    // right below it with the honest provenance facts.
    expect(installed.startsWith("---\n")).toBe(true);
    expect(installed).toContain("published by skillmaker-studio");
    expect(installed).toContain("bundle: demo-skill");
    expect(installed).toContain("evidence:");
    expect(installed).toContain("Do the demo thing.");
    // output/ siblings ride along.
    expect(readFileSync(join(installedDir, "reference.md"), "utf8")).toBe("sibling file\n");

    // Remembered in skill.json's publish.targets (THE MERGE: this bundle is
    // skill.json-born) -- the per-bundle memory traveling with the bundle in
    // git, absorbed from bundle.json's old publishTargets.
    const skillJson = JSON.parse(readFileSync(join(bundleDir, "skill.json"), "utf8")) as {
      publish?: { targets?: ReadonlyArray<string> };
    };
    expect(skillJson.publish?.targets).toEqual(["user"]);

    // Journaled with the evidence state.
    const published = installPublishEvents();
    expect(published).toHaveLength(1);
    expect(published[0]?.payload.target).toBe("user");
    expect(published[0]?.payload.versionHash).toBe(v1Hash);
    expect(String(published[0]?.payload.evidence)).toMatch(/claims measured$/);
  });

  test("bare re-publish rides the remembered target and is a true no-op (no duplicate journal event)", () => {
    const result = runCli(["publish", "demo-skill", "--json"]);
    expect(result.exitCode).toBe(0);
    const json = jsonFrom<InstallPublishJson>(result);
    expect(json?.status).toBe("published");
    expect(json?.results?.[0]?.status).toBe("already_published");
    expect(installPublishEvents()).toHaveLength(1);
  });

  test("record v2, publish, then --version reverts to v1 from the snapshot store", () => {
    writeFileSync(join(bundleDir, "output", "SKILL.md"), SKILL_V2);
    const recorded = runCli(["version", "record", "demo-skill", "--label", "v2", "--json"]);
    expect(recorded.exitCode).toBe(0);
    v2Hash = jsonFrom<{ hash: string }>(recorded)?.hash as string;

    const publishV2 = runCli(["publish", "demo-skill", "--json"]);
    expect(publishV2.exitCode).toBe(0);
    expect(jsonFrom<InstallPublishJson>(publishV2)?.versionHash).toBe(v2Hash);

    const installedSkillPath = join(claudeHome, "skills", "demo-skill", "SKILL.md");
    expect(readFileSync(installedSkillPath, "utf8")).toContain("Do the NEW demo thing.");

    // Revert: a real act, journaled -- not swallowed by the v1 publish's
    // idempotency key.
    const bareV1 = v1Hash.replace(/^sha256:/, "").slice(0, 16);
    const revert = runCli(["publish", "demo-skill", "--version", bareV1, "--json"]);
    // The prefix convention matches resolveSkillVersion: a left-anchored
    // prefix of the full "sha256:<hex>" string.
    const revertPrefixed = revert.exitCode === 0 ? revert : runCli(["publish", "demo-skill", "--version", v1Hash.slice(0, 23), "--json"]);
    expect(revertPrefixed.exitCode).toBe(0);
    const json = jsonFrom<InstallPublishJson>(revertPrefixed);
    expect(json?.versionHash).toBe(v1Hash);

    const reverted = readFileSync(installedSkillPath, "utf8");
    expect(reverted).toContain("Do the demo thing.");
    expect(reverted).not.toContain("Do the NEW demo thing.");
    expect(installPublishEvents()).toHaveLength(3);
  });

  test("unknown --to is a usage error", () => {
    const result = runCli(["publish", "demo-skill", "--to", "everyone", "--json"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('unknown --to "everyone"');
  });
});

describe("server install door", () => {
  test("POST publish {to: project} installs into the workspace's .claude/skills via the same core function", async () => {
    const response = await fetch(`${projectUrl}/bundles/demo-skill/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "project" }),
    });
    const body = (await response.json()) as InstallPublishJson;
    expect(response.status).toBe(200);
    expect(body.status).toBe("published");
    // A plain publish ships the LATEST recorded version (v2) -- the earlier
    // revert only rewrote the user install, never the live output tree.
    expect(body.versionHash).toBe(v2Hash);
    expect(body.remembered).toEqual(["user", "project"]);

    const installedDir = join(scratchDir, ".claude", "skills", "demo-skill");
    expect(existsSync(join(installedDir, "SKILL.md"))).toBe(true);
    const installed = readFileSync(join(installedDir, "SKILL.md"), "utf8");
    expect(installed).toContain("published by skillmaker-studio");

    const skillJson = JSON.parse(readFileSync(join(bundleDir, "skill.json"), "utf8")) as {
      publish?: { targets?: ReadonlyArray<string> };
    };
    expect(skillJson.publish?.targets).toEqual(["user", "project"]);
  });

  test("GET bundle detail carries the publish block: remembered audiences, last publish, installed drift", async () => {
    const response = await fetch(`${projectUrl}/bundles/demo-skill`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      publish?: {
        inPlace: boolean;
        remembered: ReadonlyArray<string>;
        targets: ReadonlyArray<{
          audience: string;
          path: string;
          displayPath: string;
          remembered: boolean;
          lastPublished: { versionHash: string; evidence: string | null } | null;
          installedDrift: string | null;
        }>;
      };
    };
    expect(body.publish).toBeDefined();
    expect(body.publish?.inPlace).toBe(false);
    expect(body.publish?.remembered).toEqual(["user", "project"]);
    const user = body.publish?.targets.find((t) => t.audience === "user");
    const project = body.publish?.targets.find((t) => t.audience === "project");
    expect(user?.path).toBe(join(claudeHome, "skills", "demo-skill"));
    expect(user?.lastPublished?.versionHash).toBe(v1Hash);
    expect(String(user?.lastPublished?.evidence)).toMatch(/claims measured$/);
    // The user copy holds v1 (the revert); faithful copy = in-sync even
    // though the stamp bytes differ from the snapshot (stamp stripped).
    expect(user?.installedDrift).toBe("in-sync");
    expect(project?.installedDrift).toBe("in-sync");

    // Hand-edit the installed user copy -> installed-edited on next read.
    const installedSkillPath = join(claudeHome, "skills", "demo-skill", "SKILL.md");
    writeFileSync(installedSkillPath, `${readFileSync(installedSkillPath, "utf8")}\nlocal hand edit\n`);
    const after = (await (await fetch(`${projectUrl}/bundles/demo-skill`)).json()) as typeof body;
    expect(after.publish?.targets.find((t) => t.audience === "user")?.installedDrift).toBe("installed-edited");
  });
});
