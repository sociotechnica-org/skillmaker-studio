/**
 * End-to-end regression: Story 3 friction log F1 -- `skillmaker version
 * record` used to call `computeBundleHashes(bundleDir)` with the default
 * `"output-dir"` layout for EVERY bundle, including in-place adopted ones
 * (`Adopt.ts`) whose payload is the bundle directory itself, not a
 * nonexistent `output/`. Hashing a directory that (from the "output/"
 * point of view) doesn't exist always produced the well-defined empty-list
 * hash `sha256("[]")` -- so every adopted bundle recorded the SAME hash
 * regardless of content, and a genuine content edit was misreported as
 * "content is unchanged" (a second recording under the same hash conflicts
 * on label rather than being accepted as new content).
 *
 * `adopt`'s own baseline recording and `run`'s auto-record both already
 * called `computeBundleHashes(bundleDir, "in-place" | layout)` correctly
 * (Adopt.ts, RunEngine.ts) -- only the `version record` CLI command (and
 * the server's mirroring `POST /api/bundles/:slug/record-version`) skipped
 * the `detectBundleLayout` call. Both now detect layout via the adopt
 * marker (`Versions.detectBundleLayout`), exactly like `status`, `adopt`,
 * and `run` already did -- one shared hashing entry point
 * (`Versions.computeBundleHashes`), layout-resolved at every call site.
 *
 * Uses the "flat `skills/<name>/SKILL.md`" adopt shape (matching
 * EveryInc's compound-engineering-plugin layout, see
 * test/e2e/phase16.e2e.test.ts) so the bundle directory sits at the same
 * path `run`/`fixture add`/`version record` all resolve it at
 * (`<root>/<skillsDir>/<slug>`) -- isolating this test to the hashing bug
 * this fix addresses, not the unrelated bundle-directory-resolution
 * question for adopted bundles that land outside `skillsDir` entirely.
 *
 * `run` is driven against a fake ACP adapter
 * (test/e2e/fixtures/fake-acp-success.cjs) -- no real LLM call, CI-safe.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const fakeAdapterSuccess = join(import.meta.dir, "fixtures", "fake-acp-success.cjs");

const EMPTY_TREE_SENTINEL = "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

let scratchDir: string;

const runCli = (args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync(["bun", cliEntry, ...args], { cwd: scratchDir, stdout: "pipe", stderr: "pipe" });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode };
};

const write = (relativePath: string, content: string): void => {
  const full = join(scratchDir, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
};

/** Points `skillmaker.config.json`'s `claude-code` provider at the fake adapter. */
const setProviderCommand = (command: ReadonlyArray<string>): void => {
  const configPath = join(scratchDir, "skillmaker.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    providers: Record<string, { command: ReadonlyArray<string> }>;
  };
  config.providers["claude-code"] = { command };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
};

interface VersionRecordCliOutput {
  readonly status: "appended" | "already_appended";
  readonly slug: string;
  readonly hash: string;
  readonly designHash: string;
}

const cliVersionRecord = (slug: string, label: string): VersionRecordCliOutput => {
  const result = runCli(["version", "record", slug, "--json", "--label", label]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout) as VersionRecordCliOutput;
};

interface RunCliOutput {
  readonly status: "completed" | "failed" | "infra-error";
  readonly skillVersionHash: string;
}

const cliRun = (slug: string, fixtureCase: string): RunCliOutput => {
  const result = runCli(["run", slug, "--fixture", fixtureCase, "--provider", "claude-code", "--json"]);
  let json: RunCliOutput | undefined;
  for (const stream of [result.stdout, result.stderr]) {
    for (const line of stream.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        json = JSON.parse(trimmed) as RunCliOutput;
        break;
      } catch {
        // not the JSON line; keep scanning
      }
    }
    if (json !== undefined) break;
  }
  expect(result.exitCode).toBe(0);
  expect(json).toBeDefined();
  return json as RunCliOutput;
};

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "skillmaker-e2e-phase20-story3-fix1-"));
  const toolVersions = join(repoRoot, ".tool-versions");
  if (existsSync(toolVersions)) {
    writeFileSync(join(scratchDir, ".tool-versions"), readFileSync(toolVersions));
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.name", "Skillmaker E2E"], { cwd: scratchDir });
  Bun.spawnSync(["git", "config", "user.email", "e2e@example.com"], { cwd: scratchDir });

  expect(runCli(["init", "--json"]).exitCode).toBe(0);

  // Two flat `skills/<name>/SKILL.md` bundles (EveryInc adopt shape) with
  // DIFFERENT content, wrapped in place by `adopt`.
  write(
    "skills/vendor-a/SKILL.md",
    "---\nname: vendor-a\ndescription: vendored skill A\n---\n# vendor-a\n\nOriginal body A.\n",
  );
  write(
    "skills/vendor-b/SKILL.md",
    "---\nname: vendor-b\ndescription: vendored skill B\n---\n# vendor-b\n\nOriginal body B, completely different.\n",
  );

  const adopt = runCli(["adopt", "--json"]);
  expect(adopt.exitCode).toBe(0);
  const adoptReport = JSON.parse(adopt.stdout) as { adopted: ReadonlyArray<{ slug: string }> };
  expect(adoptReport.adopted.map((s) => s.slug).sort()).toEqual(["vendor-a", "vendor-b"]);

  expect(runCli(["fixture", "add", "vendor-a", "golden-basic", "--json"]).exitCode).toBe(0);
  write("skills/vendor-a/evals/fixtures/golden-basic/prompt.md", "Do the thing.\n");

  setProviderCommand(["node", fakeAdapterSuccess]);
}, 30000);

afterAll(() => {
  if (scratchDir !== undefined) {
    rmSync(scratchDir, { recursive: true, force: true });
  }
});

describe("Fix F1: version record hashes an in-place adopted bundle's real content", () => {
  test("adopt's own baseline recording is already a real hash, not the empty-tree sentinel", () => {
    const status = runCli(["status", "vendor-a", "--json"]);
    expect(status.exitCode).toBe(0);
    const statusJson = JSON.parse(status.stdout) as { outputHash: string; latestVersion: { hash: string } | null };
    expect(statusJson.outputHash).not.toBe(EMPTY_TREE_SENTINEL);
    expect(statusJson.latestVersion?.hash).toBe(statusJson.outputHash);
  });

  test("personalizing SKILL.md and recording again yields a NEW real hash, not a silent no-op", () => {
    write(
      "skills/vendor-a/SKILL.md",
      "---\nname: vendor-a\ndescription: vendored skill A\n---\n# vendor-a\n\nPersonalized body A (jess-v1).\n",
    );

    const recorded = cliVersionRecord("vendor-a", "jess-v1");
    expect(recorded.status).toBe("appended");
    expect(recorded.hash).not.toBe(EMPTY_TREE_SENTINEL);

    const status = runCli(["status", "vendor-a", "--json"]);
    const statusJson = JSON.parse(status.stdout) as { outputHash: string; drift: string };
    expect(statusJson.drift).toBe("in-sync");
    expect(statusJson.outputHash).toBe(recorded.hash);
  });

  test("two differently-edited adopted bundles never share a hash", () => {
    write(
      "skills/vendor-a/SKILL.md",
      "---\nname: vendor-a\ndescription: vendored skill A\n---\n# vendor-a\n\nYet another distinct edit to A.\n",
    );
    write(
      "skills/vendor-b/SKILL.md",
      "---\nname: vendor-b\ndescription: vendored skill B\n---\n# vendor-b\n\nPersonalized body B, a totally different edit.\n",
    );

    const recordedA = cliVersionRecord("vendor-a", "vendor-a-check");
    const recordedB = cliVersionRecord("vendor-b", "vendor-b-check");

    expect(recordedA.hash).not.toBe(EMPTY_TREE_SENTINEL);
    expect(recordedB.hash).not.toBe(EMPTY_TREE_SENTINEL);
    expect(recordedA.hash).not.toBe(recordedB.hash);
  });

  test("`run`'s auto-recorded/pinned hash agrees with `version record`'s hash for the exact same content", () => {
    // Personalize once more, in sync with nothing recorded yet for this
    // exact content -- `run` must auto-record (or pin) the SAME hash
    // `version record` would compute for the identical bytes.
    write(
      "skills/vendor-a/SKILL.md",
      "---\nname: vendor-a\ndescription: vendored skill A\n---\n# vendor-a\n\nPre-run content, unique.\n",
    );

    const runOutput = cliRun("vendor-a", "golden-basic");
    expect(runOutput.status).toBe("completed");
    expect(runOutput.skillVersionHash).not.toBe(EMPTY_TREE_SENTINEL);

    // Content is unchanged since the run -- `version record` on the exact
    // same bytes must compute the IDENTICAL hash `run` just recorded/used.
    const status = runCli(["status", "vendor-a", "--json"]);
    const statusJson = JSON.parse(status.stdout) as { outputHash: string };
    expect(statusJson.outputHash).toBe(runOutput.skillVersionHash);
  });
});
