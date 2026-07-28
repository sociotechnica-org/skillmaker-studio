/**
 * `skillmaker start` -- serves the viewer + `/api/*` on one origin. Since
 * the machine-registry re-architecture (director rulings 2026-07-27) this
 * command serves the REGISTRY ONLY: it ignores cwd entirely, reads the
 * machine-level project list from `~/.skillmaker-studio/config.json`
 * (`SKILLMAKER_STUDIO_HOME` overrides the home), and serves every
 * registered project at `/api/projects/:project/...`. An EMPTY registry is
 * fine -- the UI can add the first project.
 *
 * Unlike every other command, this one keeps the process alive until
 * SIGINT/SIGTERM: it prints its startup banner directly (rather than via
 * the returned `CliResult`, which only flushes once the Effect resolves)
 * because callers -- the e2e harness included -- need to observe "serving"
 * before the command's promise settles.
 */
import {
  IndexService,
  IndexServiceLayer,
  MachineConfigMalformedError,
  machineHome,
  readMachineConfig,
} from "@skillmaker/core";
import { Effect } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "../server/BrowserOpener.ts";
import { classifyClaim, readClaim, removeClaim, writeClaim } from "../server/ClaimFile.ts";
import { startServer } from "../server/Server.ts";
import { locateViewerDist, ViewerDistNotFoundError } from "../server/ViewerDist.ts";
import { expectedFailure, ok } from "../CliResult.ts";

export interface StartOptions {
  readonly port?: number;
  readonly noOpen: boolean;
}

/** The port when `--port` is not given: the registry has no per-machine config yet, so the CLI's long-advertised default (usage line: "or 4323") is the one source. */
export const DEFAULT_START_PORT = 4323;

const readCliVersion = (): string => {
  const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

/** Resolves once SIGINT or SIGTERM is received, at most once. */
const waitForShutdown = Effect.callback<void>((resume) => {
  const handler = () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
    resume(Effect.void);
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
});

export const runStart = Effect.fn("runStart")(function* (_cwd: string, options: StartOptions) {
  const home = machineHome();

  let registeredPaths: ReadonlyArray<string>;
  try {
    registeredPaths = readMachineConfig(home).projects.map((entry) => entry.path);
  } catch (error) {
    if (error instanceof MachineConfigMalformedError) {
      return expectedFailure(`skillmaker start: ${error.message}\n`);
    }
    throw error;
  }

  // Single-instance ownership moved with the registry: one claim per
  // MACHINE home (`<home>/claims/server.json`), no longer per workspace --
  // the server serves every registered project, so one is enough.
  const claimPath = join(home, "claims", "server.json");
  const claimStatus = classifyClaim(readClaim(claimPath));
  if (claimStatus.kind === "running") {
    return ok(`skillmaker: already running at http://localhost:${claimStatus.claim.port}\n`);
  }

  let viewerDist: string;
  try {
    viewerDist = locateViewerDist(import.meta.url);
  } catch (error) {
    if (error instanceof ViewerDistNotFoundError) {
      return expectedFailure(`skillmaker start: ${error.message}\n`);
    }
    throw error;
  }

  // Warm each healthy registered project's index up front (same cold-start
  // rationale as the old single-workspace prebuild). A missing/broken
  // project never blocks startup -- the server reports it per-project.
  for (const projectRoot of registeredPaths) {
    if (!existsSync(join(projectRoot, "skillmaker.config.json"))) {
      continue;
    }
    yield* Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
    }).pipe(Effect.provide(IndexServiceLayer(projectRoot)), Effect.ignore);
  }

  const port = options.port ?? DEFAULT_START_PORT;
  const handle = startServer({
    home,
    port,
    viewerDist,
    version: readCliVersion(),
  });

  writeClaim(claimPath, { pid: process.pid, port: handle.port, startedAt: new Date().toISOString() });

  const url = `http://localhost:${handle.port}`;
  const count = registeredPaths.length;
  process.stdout.write(
    `skillmaker: serving ${count} registered project${count === 1 ? "" : "s"} at ${url}\n` +
      (count === 0 ? `skillmaker: registry is empty -- add one with \`skillmaker project add <dir>\` or from the UI\n` : ""),
  );
  if (!options.noOpen) {
    openBrowser(url);
  }

  yield* waitForShutdown;

  removeClaim(claimPath);
  yield* Effect.promise(() => handle.stop());

  return ok("skillmaker: server stopped\n");
});
