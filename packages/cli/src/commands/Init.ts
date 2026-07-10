/**
 * `skillmaker init` — scaffold skillmaker.config.json, skills/, .skillmaker/,
 * and the .gitignore/.gitattributes blocks. Re-running is a zero-file-change
 * no-op (data-model.md §2.1, plan.md Phase 1).
 */
import { Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { type CliResult, ok } from "../CliResult.ts";
import { ensureGitattributes, ensureGitignore } from "../GitFiles.ts";

export interface InitOptions {
  readonly json: boolean;
}

export const runInit = Effect.fn("runInit")(function* (cwd: string, options: InitOptions) {
  const workspace = yield* Workspace;
  const result = yield* workspace.init(cwd);

  if (result.status === "already_initialized") {
    return summarize(result.root, "already_initialized", false, false, options.json);
  }

  const gitignoreChanged = yield* ensureGitignore(result.root);
  const gitattributesChanged = yield* ensureGitattributes(result.root);

  return summarize(result.root, "initialized", gitignoreChanged, gitattributesChanged, options.json);
});

const summarize = (
  root: string,
  status: "initialized" | "already_initialized",
  gitignoreChanged: boolean,
  gitattributesChanged: boolean,
  json: boolean,
): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({ status, root, gitignoreChanged, gitattributesChanged })}\n`,
    );
  }
  if (status === "already_initialized") {
    return ok(`skillmaker: already initialized at ${root}\n`);
  }
  return ok(`skillmaker: initialized workspace at ${root}\n`);
};
