/**
 * Idempotent `.gitignore` / `.gitattributes` block insertion for
 * `skillmaker init`. Re-running init must produce zero file changes once the
 * block is present.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { WorkspaceIOError } from "@skillmaker/core";

const GITIGNORE_MARKER = ".skillmaker/*";
const GITIGNORE_BLOCK = `# Skillmaker runtime dir: everything untracked EXCEPT the journal.
# .skillmaker/events.jsonl is append-only shared history (merge=union in
# .gitattributes) and must stay in git; the rest is per-machine runtime state.
.skillmaker/*
!.skillmaker/events.jsonl
`;

const GITATTRIBUTES_LINE = ".skillmaker/events.jsonl merge=union";
const GITATTRIBUTES_BLOCK = `# The journal is append-only shared history: union-merge so events written
# on different branches combine instead of conflicting (idempotency keys
# make the union safe).
${GITATTRIBUTES_LINE}
`;

const toIOError = (message: string) => (cause: unknown) =>
  WorkspaceIOError.make({ message, cause });

/**
 * Appends `block` to the file at `filePath` if `marker` is not already
 * present anywhere in it. Returns whether the file was changed.
 */
const ensureBlock = Effect.fn("GitFiles.ensureBlock")(function* (
  filePath: string,
  marker: string,
  block: string,
) {
  const fs = yield* FileSystem;
  const exists = yield* fs
    .exists(filePath)
    .pipe(Effect.mapError(toIOError(`could not check ${filePath}`)));
  const existing = exists
    ? yield* fs
        .readFileString(filePath)
        .pipe(Effect.mapError(toIOError(`could not read ${filePath}`)))
    : "";

  if (existing.includes(marker)) {
    return false;
  }

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const separator = existing.length > 0 ? (needsLeadingNewline ? "\n\n" : "\n") : "";
  const next = `${existing}${separator}${block}`;

  yield* fs
    .writeFileString(filePath, next)
    .pipe(Effect.mapError(toIOError(`could not write ${filePath}`)));
  return true;
});

export const ensureGitignore = Effect.fn("GitFiles.ensureGitignore")(function* (root: string) {
  const path = yield* Path;
  return yield* ensureBlock(path.join(root, ".gitignore"), GITIGNORE_MARKER, GITIGNORE_BLOCK);
});

export const ensureGitattributes = Effect.fn("GitFiles.ensureGitattributes")(function* (
  root: string,
) {
  const path = yield* Path;
  return yield* ensureBlock(
    path.join(root, ".gitattributes"),
    GITATTRIBUTES_LINE,
    GITATTRIBUTES_BLOCK,
  );
});
