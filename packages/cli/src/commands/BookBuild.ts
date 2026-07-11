/**
 * `skillmaker book build [--out <dir>]` -- renders the Skillbook (data-model.md
 * §2.14) to a self-contained static site: `index.html` + one page per
 * bundle. Defaults `--out` to `.skillmaker/skillbook/` (a build artifact
 * under the runtime dir, not git-tracked content). Uses the SAME
 * `loadSkillbook` data-aggregation the server's `GET /api/skillbook` uses --
 * "one generator over existing facts, rendered two ways."
 */
import { Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { renderSkillbookSite } from "../BookRenderer.ts";
import { loadSkillbook } from "../Skillbook.ts";
import { type CliResult, expectedFailure, ok } from "../CliResult.ts";

export interface BookBuildOptions {
  readonly json: boolean;
  readonly out?: string;
}

export const runBookBuild = Effect.fn("runBookBuild")(function* (cwd: string, options: BookBuildOptions) {
  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker book build: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const path = yield* Path;
  const fs = yield* FileSystem;
  const outDir =
    options.out !== undefined
      ? path.isAbsolute(options.out)
        ? options.out
        : path.join(cwd, options.out)
      : path.join(resolved.root, ".skillmaker", "skillbook");

  const dataOutcome = yield* Effect.tryPromise({
    try: () => loadSkillbook(resolved.root, resolved.config),
    catch: (cause) => `could not build skillbook: ${String(cause)}`,
  }).pipe(
    Effect.map((value) => ({ kind: "ok" as const, value })),
    Effect.catchEager((message: string) => Effect.succeed({ kind: "error" as const, message })),
  );

  if (dataOutcome.kind === "error") {
    return expectedFailure(`skillmaker book build: ${dataOutcome.message}\n`);
  }
  const data = dataOutcome.value;

  const pages = renderSkillbookSite(data);

  yield* fs.makeDirectory(outDir, { recursive: true });
  for (const page of pages) {
    yield* fs.writeFileString(path.join(outDir, page.fileName), page.html);
  }

  return summarize(outDir, data.bundles.length, options.json);
});

const summarize = (outDir: string, bundleCount: number, json: boolean): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status: "built", outDir, pages: bundleCount + 1 })}\n`);
  }
  return ok(`skillmaker: built skillbook (${bundleCount} skill(s), ${bundleCount + 1} page(s)) at ${outDir}\n`);
};
