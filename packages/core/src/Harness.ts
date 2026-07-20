/**
 * Agent-harness presence detection + repo-local skill registration
 * (docs/proposals/2026-07-20-install-simplification.md Phase A.5 / B.7):
 * `skillmaker init` detects which harness(es) a repo already carries and
 * installs the `/skillmaker` skill file into each present harness's
 * repo-local skill directory. Shared by `init` (A.5) and any future
 * standalone registration command (B.7) -- one code path, per the spec's
 * ruling that registration logic lives here, not duplicated at each call
 * site.
 *
 * v1 scope is Claude Code and Codex only (spec ruling: "Harness scope:
 * Claude Code and Codex only"). Presence is read from each harness's own
 * well-known config directory at the repo root (`.claude/`, `.codex/`) --
 * the same "normal spot" signal a maker would look for by hand. Codex's
 * skill INSTALL directory is `.agents/skills/`, not `.codex/skills/`
 * (`ProviderProfile.ts`'s doc comment: codex-acp reads
 * `.agents/skills/<slug>/SKILL.md`, confirmed live against a real
 * codex-acp session) -- presence detection and install location are
 * deliberately different paths for that one harness.
 */
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { join } from "node:path";
import { WorkspaceIOError } from "./Errors.ts";

const toIOError = (message: string) => (cause: unknown) => WorkspaceIOError.make({ message, cause });

export const HARNESS_KINDS = ["claude-code", "codex"] as const;
export type HarnessKind = (typeof HARNESS_KINDS)[number];

/** The directory whose presence at a repo root signals "this harness is set up here" -- the same directory each harness's own CLI creates/uses (`claude`'s `.claude/`, `codex`'s `.codex/`). */
export const HARNESS_PRESENCE_DIR: Readonly<Record<HarnessKind, string>> = {
  "claude-code": ".claude",
  codex: ".codex",
};

/** Where each harness's ACP adapter actually reads repo-local skills from (`ProviderProfile.ts`'s per-provider findings) -- NOT necessarily the same directory as `HARNESS_PRESENCE_DIR`. */
export const HARNESS_SKILL_INSTALL_DIR: Readonly<Record<HarnessKind, string>> = {
  "claude-code": ".claude/skills",
  codex: ".agents/skills",
};

/** Display name for CLI output. */
export const HARNESS_LABEL: Readonly<Record<HarnessKind, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

export interface HarnessDetection {
  readonly kind: HarnessKind;
  readonly present: boolean;
}

/**
 * Checks every known harness's presence directory at `root`. Order matches
 * `HARNESS_KINDS` -- always one entry per harness, `present: false` rather
 * than an absent entry, so a caller never has to guess which harnesses were
 * checked.
 */
export const detectHarnesses = Effect.fn("Harness.detectHarnesses")(function* (root: string) {
  const fs = yield* FileSystem;
  const results: HarnessDetection[] = [];
  for (const kind of HARNESS_KINDS) {
    const present = yield* fs
      .exists(join(root, HARNESS_PRESENCE_DIR[kind]))
      .pipe(Effect.mapError(toIOError(`could not check ${HARNESS_PRESENCE_DIR[kind]}`)));
    results.push({ kind, present });
  }
  return results;
});

export interface SkillInstallResult {
  readonly kind: HarnessKind;
  readonly path: string;
  /** `false` when the file already held byte-identical content -- a real no-op, not just "we didn't check." */
  readonly changed: boolean;
}

/**
 * Writes `content` to `<root>/<install-dir>/skillmaker/SKILL.md` for every
 * PRESENT harness in `harnesses` (an absent harness is skipped, not
 * installed to anyway). Idempotent: identical content already on disk is
 * left untouched (`changed: false`) so re-running `skillmaker init` never
 * dirties a git worktree that hasn't actually changed.
 *
 * Registration is repo-local by construction (spec ruling: "everything in
 * Skillmaker Studio is repo-local") -- always writes under `root`, never
 * `~/.claude` or `~/.codex`. The caller (`Init.ts`) is responsible for
 * printing the gitignore hint; this function only writes files.
 */
export const registerSkill = Effect.fn("Harness.registerSkill")(function* (
  root: string,
  harnesses: ReadonlyArray<HarnessDetection>,
  content: string,
) {
  const fs = yield* FileSystem;
  const results: SkillInstallResult[] = [];
  for (const harness of harnesses) {
    if (!harness.present) {
      continue;
    }
    const dir = join(root, ...HARNESS_SKILL_INSTALL_DIR[harness.kind].split("/"), "skillmaker");
    const filePath = join(dir, "SKILL.md");
    const exists = yield* fs.exists(filePath).pipe(Effect.mapError(toIOError(`could not check ${filePath}`)));
    const previous = exists
      ? yield* fs.readFileString(filePath).pipe(Effect.mapError(toIOError(`could not read ${filePath}`)))
      : undefined;
    if (previous === content) {
      results.push({ kind: harness.kind, path: filePath, changed: false });
      continue;
    }
    yield* fs
      .makeDirectory(dir, { recursive: true })
      .pipe(Effect.mapError(toIOError(`could not create ${dir}`)));
    yield* fs
      .writeFileString(filePath, content)
      .pipe(Effect.mapError(toIOError(`could not write ${filePath}`)));
    results.push({ kind: harness.kind, path: filePath, changed: true });
  }
  return results;
});
