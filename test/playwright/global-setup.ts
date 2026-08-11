import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(process.cwd());
const cliEntry = join(repoRoot, "packages", "cli", "src", "main.ts");
const viewerIndex = join(repoRoot, "packages", "viewer", "dist", "index.html");

const run = (command: ReadonlyArray<string>, cwd: string): string => {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `Playwright setup command failed (${command.join(" ")}):\n${result.stderr}\n${result.stdout}`,
    );
  }
  return result.stdout;
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const waitForHealth = async (baseUrl: string, child: ReturnType<typeof spawn>): Promise<void> => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Skillmaker test server exited during startup with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Skillmaker test server never became healthy at ${baseUrl}`);
};

const startServer = async (
  cwd: string,
  home: string,
): Promise<{ readonly baseUrl: string; readonly pid: number }> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Match test/e2e/support/server.ts: stay below Linux's ephemeral range.
    const port = 20_000 + Math.floor(Math.random() * 12_000);
    const child = spawn("bun", [cliEntry, "start", "--port", String(port), "--no-open"], {
      cwd,
      env: { ...process.env, SKILLMAKER_STUDIO_HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.unref();
    try {
      await waitForHealth(`http://127.0.0.1:${port}`, child);
      if (child.pid === undefined) throw new Error("Skillmaker test server has no pid");
      return { baseUrl: `http://127.0.0.1:${port}`, pid: child.pid };
    } catch (cause) {
      lastError = new Error(`${String(cause)}\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`);
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  }
  throw lastError;
};

const initializeProject = (projectDir: string): void => {
  mkdirSync(projectDir, { recursive: true });
  run(["git", "init", "-q"], projectDir);
  run(["git", "config", "user.name", "Skillmaker Playwright"], projectDir);
  run(["git", "config", "user.email", "playwright@example.com"], projectDir);
  if (existsSync(join(repoRoot, ".tool-versions"))) {
    cpSync(join(repoRoot, ".tool-versions"), join(projectDir, ".tool-versions"));
  }
  run(["bun", cliEntry, "init", "--json"], projectDir);
  run(["bun", cliEntry, "new", "fixture-maestro", "--json"], projectDir);
  run(["bun", cliEntry, "new", "idea-compass", "--json"], projectDir);

  const fixtureBundle = join(projectDir, "skills", "fixture-maestro");
  mkdirSync(join(fixtureBundle, "research"), { recursive: true });
  writeFileSync(
    join(fixtureBundle, "design.md"),
    "# Fixture Maestro design\n\nA deterministic viewer fixture with inspectable evidence.\n",
  );
  writeFileSync(
    join(fixtureBundle, "research", "notes.md"),
    "# Research notes\n\nThe viewer should preserve this fold.\n\n" +
      Array.from({ length: 48 }, (_, index) => `## Finding ${index + 1}\n\nEvidence line ${index + 1} for sticky scrolling.`).join("\n\n") +
      "\n",
  );
  writeFileSync(
    join(fixtureBundle, "research", "decisions.md"),
    "# Decisions\n\nPrefer semantic browser journeys over implementation selectors.\n",
  );
  writeFileSync(
    join(fixtureBundle, "output", "SKILL.md"),
    `---\nname: fixture-maestro\ndescription: Exercises the shipped Skillmaker Studio viewer.\n---\n\n# Fixture Maestro\n\nA complete prompt used by the browser suite.\n\n## Ordered workflow\n\n3. Inspect the registered project.\n4. Expand the fixture evidence.\n5. Keep the composer editable.\n\n## Full instructions\n\nThis final section proves the Prompt tab renders the entire SKILL.md instead of only its overview slice.\n`,
  );
  writeJson(join(fixtureBundle, "evals.json"), {
    failureHypotheses: [
      {
        id: "OUT-1",
        failure: "The viewer hides the authored fixture prompt.",
        probability: "Medium",
        impact: "High",
        mustNever: "The fixture prompt must never disappear behind an agent run.",
        proofSpecs: [
          {
            name: "visible-evidence",
            setup: "Open the Eval tab.",
            expectedBehavior: "The prompt body is readable from the claims tree.",
          },
        ],
      },
    ],
  });
  run(
    ["bun", cliEntry, "fixture", "add", "fixture-maestro", "visible-evidence", "--risks", "OUT-1", "--json"],
    projectDir,
  );
  const fixtureDir = join(fixtureBundle, "evals", "fixtures", "visible-evidence");
  writeFileSync(
    join(fixtureDir, "prompt.md"),
    "<!-- Confirms authored evidence remains inspectable. -->\n\nExplain why deterministic browser tests should avoid arbitrary sleeps.\n",
  );
  const fixtureCase = JSON.parse(readFileSync(join(fixtureDir, "case.json"), "utf8"));
  fixtureCase.grading = {
    answerKey: "Playwright auto-waits on observable UI state.",
    checks: ["mentions observable state", "avoids arbitrary sleeps"],
  };
  writeJson(join(fixtureDir, "case.json"), fixtureCase);

  for (const stage of ["researching", "drafting", "evaluating"]) {
    run(["bun", cliEntry, "advance", "fixture-maestro", "--to", stage, "--override", "--json"], projectDir);
  }
  const versionOutput = JSON.parse(
    run(["bun", cliEntry, "version", "record", "fixture-maestro", "--label", "playwright-v1", "--json"], projectDir),
  );
  const versionHash = versionOutput.hash;
  if (typeof versionHash !== "string") throw new Error("Version record did not return a hash");

  const runId = "01JPLAYWRIGHT0000000000000";
  const runDir = join(fixtureBundle, "runs", runId);
  mkdirSync(join(runDir, "artifacts"), { recursive: true });
  writeJson(join(runDir, "run.json"), {
    schemaVersion: 1,
    id: runId,
    bundle: "fixture-maestro",
    kind: "eval",
    station: null,
    fixtureCase: "visible-evidence",
    skillVersionHash: versionHash,
    provider: "fixture-provider",
    model: "fixture-model",
    startedAt: "2026-08-11T12:00:00.000Z",
    endedAt: "2026-08-11T12:00:01.000Z",
    status: "completed",
    actor: { kind: "user", name: "playwright" },
    isolation: "sandbox-home",
    skillInvoked: true,
  });
  writeFileSync(join(runDir, "response.md"), "The deterministic fixture completed successfully.\n");
  run(
    [
      "bun",
      cliEntry,
      "grade",
      "fixture-maestro",
      runId,
      "--verdict",
      "pass",
      "--notes",
      "fixture grade",
      "--json",
    ],
    projectDir,
  );

  const ideaBundle = join(projectDir, "skills", "idea-compass");
  writeFileSync(join(ideaBundle, "design.md"), "# Idea Compass\n\nA deliberately bare idea-stage bundle.\n");
  writeJson(join(ideaBundle, "evals.json"), {
    failureHypotheses: [
      {
        id: "IN-1",
        failure: "An ambiguous request reaches the future prompt unchanged.",
        probability: "Medium",
        impact: "Medium",
        mustNever: "The skill must never invent missing intent.",
        proofSpecs: [
          {
            name: "ambiguous-request",
            setup: "Provide an underspecified request.",
            expectedBehavior: "The skill asks for the missing decision.",
          },
        ],
      },
    ],
  });
};

export default async function globalSetup(): Promise<void> {
  if (!existsSync(viewerIndex)) {
    run(["bun", "run", "build:viewer"], repoRoot);
  }

  const scratchRoot = mkdtempSync(join(tmpdir(), "skillmaker-playwright-"));
  const projectDir = join(scratchRoot, "playwright-project");
  initializeProject(projectDir);

  const fixtureHome = join(scratchRoot, "fixture-home");
  const emptyHome = join(scratchRoot, "empty-home");
  mkdirSync(fixtureHome);
  mkdirSync(emptyHome);
  writeJson(join(fixtureHome, "config.json"), { projects: [{ path: projectDir }] });
  writeJson(join(emptyHome, "config.json"), { projects: [] });

  const startedPids: number[] = [];
  let fixtureServer: Awaited<ReturnType<typeof startServer>>;
  let emptyServer: Awaited<ReturnType<typeof startServer>>;
  try {
    fixtureServer = await startServer(projectDir, fixtureHome);
    startedPids.push(fixtureServer.pid);
    emptyServer = await startServer(projectDir, emptyHome);
    startedPids.push(emptyServer.pid);
  } catch (cause) {
    for (const pid of startedPids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already stopped.
      }
    }
    rmSync(scratchRoot, { recursive: true, force: true });
    throw cause;
  }

  process.env.SKILLMAKER_PLAYWRIGHT_URL = fixtureServer.baseUrl;
  process.env.SKILLMAKER_PLAYWRIGHT_EMPTY_URL = emptyServer.baseUrl;
  process.env.SKILLMAKER_PLAYWRIGHT_STATE = JSON.stringify({
    scratchRoot,
    pids: startedPids,
  });
}
