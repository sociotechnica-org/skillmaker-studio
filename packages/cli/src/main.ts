#!/usr/bin/env bun
/**
 * skillmaker — CLI entry point.
 *
 * The runtime edge: this is the only file that builds the top-level layer,
 * runs an Effect program, writes to stdout/stderr, and calls process.exit.
 */
import { type CliResult } from "./CliResult.ts";
import { WorkspaceLayer } from "@skillmaker/core";
import { BunServices } from "@effect/platform-bun";
import { Cause, Effect, Layer } from "effect";
import { run } from "./Cli.ts";
import { isDebugRequested, renderFailure } from "./ErrorBoundary.ts";

// `provideMerge` (not `provide`): commands also need FileSystem/Path
// directly (e.g. to build the workspace-root-dependent Journal layer), so
// those services must stay in the output, not just satisfy Workspace's
// construction.
const AppLayer = Layer.provideMerge(WorkspaceLayer, BunServices.layer);

const argv = process.argv.slice(2);
const debug = isDebugRequested(argv, process.env);

const program: Effect.Effect<CliResult> = Effect.gen(function* () {
  return yield* run(argv, process.cwd());
}).pipe(
  Effect.provide(AppLayer),
  Effect.catchCause((cause: Cause.Cause<unknown>) =>
    Effect.succeed<CliResult>({
      stdout: "",
      stderr: renderFailure(cause, debug),
      exitCode: 1,
    }),
  ),
);

const result = await Effect.runPromise(program);

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}
if (result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}
process.exit(result.exitCode);
