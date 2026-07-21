/**
 * End-to-end: the golden path on the actual DISTRIBUTED artifact
 * (plan.md Phase 12 "install the binary on a clean machine ... and run the
 * whole golden path from `init`") -- not `bun packages/cli/src/main.ts`
 * like the other e2e suites, the real `dist/skillmaker` binary produced by
 * `scripts/build-dist.sh`, run from a copy that has no relationship to the
 * repo checkout, against a fresh workspace with no relationship to the
 * repo checkout either. This is what exercises
 * packages/cli/src/server/ViewerDist.ts's execPath-relative discovery --
 * the module-relative walk can't find anything real from inside a compiled
 * binary (`import.meta.url` there is a virtual `/$bunfs/...` path).
 *
 * `dist/skillmaker` is a build artifact (dist/ is gitignored), so this
 * suite is guarded: if it's missing, tests report as skipped with a clear
 * message rather than failing CI on a fresh checkout. To run for real:
 *
 *   bun run build:dist && bun test test/e2e/dist.e2e.test.ts
 *
 * (build-dist.sh is not invoked automatically from here -- it takes
 * ~1-2s once dependencies/viewer are already built, but a cold run also
 * does `bun install` + a full viewer build, which is too slow to hide
 * inside a test's `beforeAll` without misleading timeouts.)
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startE2eServer } from "./support/server.ts";

const repoRoot = join(import.meta.dir, "..", "..");
const distBinary = join(repoRoot, "dist", "skillmaker");
const distViewer = join(repoRoot, "dist", "viewer-dist");

const distArtifactsPresent = existsSync(distBinary) && existsSync(distViewer);

let installDir: string;
let workspaceDir: string;
let binaryPath: string;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let port: number;
let baseUrl: string;

const runBinary = (args: ReadonlyArray<string>, cwd: string) => {
  const result = Bun.spawnSync([binaryPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
};

const claimPath = () =>
  join(workspaceDir, ".skillmaker", "claims", "server.json");

describe.skipIf(!distArtifactsPresent)(
  "skillmaker distributed binary: golden path (Phase 12a)",
  () => {
    beforeAll(async () => {
      // "Install": copy the two distributable pieces into a directory that
      // shares nothing with the repo checkout, exactly as a real install
      // would (docs/dist.md).
      installDir = mkdtempSync(join(tmpdir(), "skillmaker-dist-install-"));
      cpSync(distBinary, join(installDir, "skillmaker"));
      cpSync(distViewer, join(installDir, "viewer-dist"), { recursive: true });
      binaryPath = join(installDir, "skillmaker");
      Bun.spawnSync(["chmod", "+x", binaryPath]);

      // Fresh workspace, also unrelated to the repo checkout.
      workspaceDir = mkdtempSync(join(tmpdir(), "skillmaker-dist-workspace-"));
      Bun.spawnSync(["git", "init", "-q"], { cwd: workspaceDir });
      Bun.spawnSync(["git", "config", "user.name", "Skillmaker Dist E2E"], {
        cwd: workspaceDir,
      });
      Bun.spawnSync(["git", "config", "user.email", "dist-e2e@example.com"], {
        cwd: workspaceDir,
      });

      const init = runBinary(["init", "--json"], workspaceDir);
      expect(init.exitCode).toBe(0);

      const created = runBinary(["new", "demo-skill", "--json"], workspaceDir);
      expect(created.exitCode).toBe(0);

      const list = runBinary(["list", "--json"], workspaceDir);
      expect(list.exitCode).toBe(0);
      expect(
        (JSON.parse(list.stdout) as { bundles: unknown[] }).bundles,
      ).toHaveLength(1);

      const outputDir = join(workspaceDir, "skills", "demo-skill", "output");
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        join(outputDir, "SKILL.md"),
        "# Demo Skill\n\nA skill compiled and installed as a standalone binary.\n",
      );

      const versionRecord = runBinary(
        ["version", "record", "demo-skill", "--json", "--label", "v1"],
        workspaceDir,
      );
      expect(versionRecord.exitCode).toBe(0);
      expect(
        (JSON.parse(versionRecord.stdout) as { status: string }).status,
      ).toBe("appended");

      const server = await startE2eServer({
        command: (port) => [binaryPath, "start", "--port", String(port), "--no-open"],
        cwd: workspaceDir,
      });
      serverProcess = server.process;
      port = server.port;
      baseUrl = server.baseUrl;
      // 90s, not the old 30s: the wait above is readiness-driven with a
      // 60s backstop -- the hook budget must outlast the backstop so a
      // genuine failure surfaces the helper's diagnostic error, not bun's
      // bare hook timeout.
    }, 90000);

    afterAll(async () => {
      if (serverProcess !== undefined) {
        serverProcess.kill("SIGTERM");
        await serverProcess.exited;
      }
      if (workspaceDir !== undefined) {
        rmSync(workspaceDir, { recursive: true, force: true });
      }
      if (installDir !== undefined) {
        rmSync(installDir, { recursive: true, force: true });
      }
    });

    test("GET /api/health reports ok", async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });

    test("GET /api/bundles shows the bundle created via the binary", async () => {
      const response = await fetch(`${baseUrl}/api/bundles`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        bundles: ReadonlyArray<{ slug: string }>;
      };
      expect(body.bundles.map((b) => b.slug)).toEqual(["demo-skill"]);
    });

    test("GET / serves the viewer HTML from the standalone viewer-dist/", async () => {
      const response = await fetch(`${baseUrl}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain('id="app-root"');
    });

    test("claim file exists at the started port", () => {
      expect(existsSync(claimPath())).toBe(true);
      const claim = JSON.parse(readFileSync(claimPath(), "utf8")) as {
        port: number;
      };
      expect(claim.port).toBe(port);
    });

    test("SIGTERM stops the binary cleanly and removes the claim file", async () => {
      if (serverProcess === undefined) {
        throw new Error("server process not started");
      }
      serverProcess.kill("SIGTERM");
      const exitCode = await serverProcess.exited;
      serverProcess = undefined;
      expect(exitCode).toBe(0);
      expect(existsSync(claimPath())).toBe(false);
    }, 10000);
  },
);

if (!distArtifactsPresent) {
  // `describe.skipIf` above reports every test inside as skipped, but bun
  // test's summary line doesn't say *why* -- print it once so a CI run or
  // local run that never built dist/ doesn't look like a silently-empty
  // suite.
  console.log(
    "skillmaker dist e2e: skipped -- dist/skillmaker or dist/viewer-dist/ not found. " +
      "Run `bun run build:dist && bun test test/e2e/dist.e2e.test.ts` to run this suite for real.",
  );
}
