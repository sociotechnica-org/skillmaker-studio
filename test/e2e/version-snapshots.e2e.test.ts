/**
 * E2e for version snapshots (director ruling 2026-07-25): recording a
 * version KEEPS its content -- `design.md` + the skill payload are copied
 * into `<bundle>/.skillmaker/versions/<bare-hash>/`, so history lives in
 * the bundle. The journal event stays a hashes-only receipt.
 *
 * Locked at both doors:
 *   1. CLI: `version record` writes the snapshot; `version show <slug>
 *      <hash>` lists it (full hash, bare-hex, or prefix); re-recording is a
 *      no-op receipt with the identical snapshot.
 *   2. Server: bundle detail's `versions[]` carries `snapshot: boolean`;
 *      `GET /api/bundles/:slug/versions/:hash/files` lists the kept
 *      content; `.../file?path=` reads one file; traversal and
 *      out-of-snapshot paths 404.
 *   3. Honesty: a receipt appended before snapshots existed (simulated by a
 *      hand-written journal line) stays `snapshot: false`, 404s on the
 *      files endpoint, and `version show` explains the content was never
 *      kept.
 *   4. Snapshots never register as drift: recording twice in a row yields
 *      `already_appended` (hashes unchanged by the snapshot itself), and
 *      the Files tab tree does not list snapshot paths.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eRegistryServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");

let scratchDir: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let baseUrl: string;
let projectUrl: string;

let recordedHash = ""; // "sha256:<hex>", captured from `version record --json`
const bareHex = (): string => recordedHash.replace(/^sha256:/, "");

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], {
    cwd: scratchDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

const bundleDir = () => join(scratchDir, "skills", "demo-skill");
const snapshotRoot = () => join(bundleDir(), ".skillmaker", "versions");

beforeAll(async () => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-version-snapshots-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });
  expect(runCli(["init", "--json"]).exitCode).toBe(0);
  expect(runCli(["new", "demo-skill", "--json"]).exitCode).toBe(0);

  writeFileSync(join(bundleDir(), "output", "SKILL.md"), "# Demo Skill\n\nDo the demo thing.\n");

  const server = await startE2eRegistryServer({
    command: (port) => ["bun", cliEntry, "start", "--port", String(port), "--no-open"],
    cwd: scratchDir,
  });
  serverProcess = server.process;
  baseUrl = server.baseUrl;
  projectUrl = server.projectUrls[0] as string;
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

describe("version snapshots through the CLI door", () => {
  test("version record keeps design.md + output/ under .skillmaker/versions/<bare-hash>/", () => {
    const result = runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; hash: string };
    expect(parsed.status).toBe("appended");
    recordedHash = parsed.hash;

    const snapshotDir = join(snapshotRoot(), bareHex());
    expect(readFileSync(join(snapshotDir, "output", "SKILL.md"), "utf8")).toContain("Do the demo thing.");
    expect(existsSync(join(snapshotDir, "design.md"))).toBe(true);
  });

  test("re-recording identical content is already_appended -- the snapshot never registers as drift of what it recorded", () => {
    const result = runCli(["version", "record", "demo-skill", "--label", "v1", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { status: string; hash: string };
    expect(parsed.status).toBe("already_appended");
    expect(parsed.hash).toBe(recordedHash);
  });

  test("version show lists the snapshot's files, by full hash, bare hex, or prefix", () => {
    const full = runCli(["version", "show", "demo-skill", recordedHash]);
    expect(full.exitCode).toBe(0);
    expect(full.stdout).toContain("output/SKILL.md");
    expect(full.stdout).toContain("design.md");
    expect(full.stdout).toContain('"v1"');

    const prefix = runCli(["version", "show", "demo-skill", bareHex().slice(0, 12), "--json"]);
    expect(prefix.exitCode).toBe(0);
    const parsed = JSON.parse(prefix.stdout) as { hash: string; files: ReadonlyArray<string> };
    expect(parsed.hash).toBe(recordedHash);
    expect(parsed.files).toContain("output/SKILL.md");
  });

  test("version show is honest about an unknown hash", () => {
    const result = runCli(["version", "show", "demo-skill", "ffffffffffff"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no recorded version matching");
  });
});

describe("version snapshots over HTTP", () => {
  test("bundle detail's versions[] carries snapshot: true for a kept version", async () => {
    const response = await fetch(`${projectUrl}/bundles/demo-skill`);
    expect(response.status).toBe(200);
    const detail = (await response.json()) as {
      versions: ReadonlyArray<{ hash: string; snapshot: boolean }>;
      files: ReadonlyArray<string>;
    };
    const recorded = detail.versions.find((version) => version.hash === recordedHash);
    expect(recorded?.snapshot).toBe(true);
    // Snapshots are history, not reviewable working content -- the Files
    // tab's list must not contain snapshot paths.
    expect(detail.files.some((path) => path.includes(".skillmaker"))).toBe(false);
  });

  test("GET versions/:hash/files lists the kept content (bare hex works)", async () => {
    const response = await fetch(`${projectUrl}/bundles/demo-skill/versions/${bareHex()}/files`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      hash: string;
      label: string | null;
      files: ReadonlyArray<{ path: string; size: number }>;
    };
    expect(body.hash).toBe(recordedHash);
    expect(body.label).toBe("v1");
    expect(body.files.map((file) => file.path)).toContain("output/SKILL.md");
  });

  test("GET versions/:hash/file reads one snapshot file", async () => {
    const response = await fetch(
      `${projectUrl}/bundles/demo-skill/versions/${bareHex()}/file?path=output/SKILL.md`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { path: string; content: string };
    expect(body.content).toContain("Do the demo thing.");
  });

  test("traversal and outside-the-snapshot paths 404, never leak", async () => {
    const traversal = await fetch(
      `${projectUrl}/bundles/demo-skill/versions/${bareHex()}/file?path=..%2F..%2F..%2Fdesign.md`,
    );
    expect(traversal.status).toBe(404);
    const outside = await fetch(
      `${projectUrl}/bundles/demo-skill/versions/${bareHex()}/file?path=bundle.json`,
    );
    expect(outside.status).toBe(404);
    const unknownHash = await fetch(`${projectUrl}/bundles/demo-skill/versions/ffffffffffff/files`);
    expect(unknownHash.status).toBe(404);
  });

  test("the files-tab walk does not recurse into snapshots", async () => {
    const response = await fetch(`${projectUrl}/bundles/demo-skill/files`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { files: ReadonlyArray<{ path: string }> };
    expect(body.files.length).toBeGreaterThan(0);
    expect(body.files.some((file) => file.path.includes(".skillmaker"))).toBe(false);
  });
});

describe("pre-snapshot receipts stay honest", () => {
  const ghostHash = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

  test("a receipt without kept content reads snapshot: false, 404s on files, and version show explains why", async () => {
    // Simulate a version recorded before snapshots existed: a receipt on
    // the journal with no content kept anywhere. (Back-filling is
    // impossible -- the content is gone -- so the system must say so.)
    const event = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: { kind: "user", name: "e2e" },
      type: "skill.version_recorded",
      idempotencyKey: `skill.version_recorded:demo-skill:sha256:ghost:${ghostHash}`,
      payload: { bundle: "demo-skill", hash: ghostHash, designHash: "sha256:ghost", label: "pre-snapshot" },
    };
    appendFileSync(join(scratchDir, ".skillmaker", "events.jsonl"), `${JSON.stringify(event)}\n`);

    const detail = await fetch(`${projectUrl}/bundles/demo-skill`);
    const body = (await detail.json()) as { versions: ReadonlyArray<{ hash: string; snapshot: boolean }> };
    const ghost = body.versions.find((version) => version.hash === ghostHash);
    expect(ghost).toBeDefined();
    expect(ghost?.snapshot).toBe(false);

    const files = await fetch(`${projectUrl}/bundles/demo-skill/versions/${ghostHash.slice(7)}/files`);
    expect(files.status).toBe(404);
    const error = (await files.json()) as { error: string };
    expect(error.error).toContain("recorded before snapshots existed");

    const show = runCli(["version", "show", "demo-skill", ghostHash]);
    expect(show.exitCode).toBe(1);
    expect(show.stderr).toContain("recorded before snapshots existed");
  });
});

describe("record-version endpoint snapshots too (same core path)", () => {
  test("POST record-version after a content change keeps the NEW content under a NEW hash", async () => {
    writeFileSync(join(bundleDir(), "output", "SKILL.md"), "# Demo Skill\n\nDo the demo thing, v2.\n");

    const response = await fetch(`${projectUrl}/bundles/demo-skill/record-version`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "v2" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; hash: string };
    expect(body.status).toBe("appended");
    expect(body.hash).not.toBe(recordedHash);

    const newSnapshot = join(snapshotRoot(), body.hash.replace(/^sha256:/, ""), "output", "SKILL.md");
    expect(readFileSync(newSnapshot, "utf8")).toContain("v2");
    // The first version's snapshot is untouched -- history accumulates.
    const oldSnapshot = join(snapshotRoot(), bareHex(), "output", "SKILL.md");
    expect(readFileSync(oldSnapshot, "utf8")).not.toContain("v2");
  });
});
