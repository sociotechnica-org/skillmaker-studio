/**
 * `skillmaker start` -- serves the viewer + `/api/*` on one origin
 * (plan.md Phase 3). Unlike every other command, this one keeps the process
 * alive until SIGINT/SIGTERM: it prints its startup banner directly (rather
 * than via the returned `CliResult`, which only flushes once the Effect
 * resolves) because callers -- the e2e harness included -- need to observe
 * "serving" before the command's promise settles.
 */
import { IndexService, IndexServiceLayer, Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
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

export const runStart = Effect.fn("runStart")(function* (cwd: string, options: StartOptions) {
  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker start: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const claimPath = join(resolved.root, ".skillmaker", "claims", "server.json");
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

  yield* Effect.gen(function* () {
    const index = yield* IndexService;
    yield* index.rebuild();
  }).pipe(Effect.provide(IndexServiceLayer(resolved.root)));

  const port = options.port ?? resolved.config.viewer.port;
  const handle = startServer({
    root: resolved.root,
    config: resolved.config,
    port,
    viewerDist,
    version: readCliVersion(),
  });

  writeClaim(claimPath, { pid: process.pid, port: handle.port, startedAt: new Date().toISOString() });

  const url = `http://localhost:${handle.port}`;
  process.stdout.write(`skillmaker: serving ${resolved.config.name} at ${url}\n`);
  if (!options.noOpen) {
    openBrowser(url);
  }

  yield* waitForShutdown;

  removeClaim(claimPath);
  yield* Effect.promise(() => handle.stop());

  return ok("skillmaker: server stopped\n");
});
