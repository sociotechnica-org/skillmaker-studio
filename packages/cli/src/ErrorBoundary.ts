/**
 * `main.ts`'s top-level `Effect.catchCause` renders EVERY uncaught failure
 * (any command, any layer) the same way: `skillmaker: unexpected error` plus
 * a full Effect stack trace (`Cause.pretty`). That's right for a genuine
 * defect, but wrong for the handful of well-understood, likely-on-first-touch
 * failure modes that already carry a human-readable `message` (a corrupt
 * `.skillmaker/events.jsonl`, a read-only cwd during `init`) -- those don't
 * need 30 lines of Effect internals, they need one honest line and a next
 * step.
 *
 * Deliberately narrow: this only recognizes the tagged errors listed in
 * `KNOWN_ERROR_SUGGESTIONS` below (`JournalReadError`, `WorkspaceIOError` --
 * add more here as they turn out to matter, no need to touch main.ts).
 * Everything else -- unknown tags, defects, multi-failure causes -- falls
 * through to the existing full-stack-trace rendering unchanged. `--debug`
 * (argv) or `SKILLMAKER_DEBUG=1` (env) forces the full stack trace even for
 * a recognized error, for whoever actually needs it.
 */
import { Cause } from "effect";

const KNOWN_ERROR_SUGGESTIONS: Readonly<Record<string, string>> = {
  JournalReadError: "check .skillmaker/events.jsonl for corruption or a manual edit that broke its format",
  WorkspaceIOError: "check file permissions and that the workspace directory is writable",
};

interface TaggedMessageError {
  readonly _tag: string;
  readonly message: string;
}

const isTaggedMessageError = (value: unknown): value is TaggedMessageError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  typeof (value as { _tag: unknown })._tag === "string" &&
  "message" in value &&
  typeof (value as { message: unknown }).message === "string";

/** True when either `--debug` was passed or `SKILLMAKER_DEBUG` is set to a non-empty value. */
export const isDebugRequested = (argv: ReadonlyArray<string>, env: Record<string, string | undefined>): boolean =>
  argv.includes("--debug") || Boolean(env.SKILLMAKER_DEBUG);

/**
 * Renders a one-line, human-readable message for a cause that reduces to
 * exactly one of the known tagged errors -- `undefined` for anything else
 * (multi-failure causes, defects, unrecognized tags), which tells the
 * caller to fall back to the full `Cause.pretty` rendering.
 */
export const formatKnownFailure = (cause: Cause.Cause<unknown>): string | undefined => {
  // Effect 4's `Cause` is a flat list of `reasons` (Fail/Die/Interrupt) --
  // require EXACTLY one reason, and that it's a `Fail`, before treating the
  // cause as "one recognized error" (anything else -- a defect, an
  // interrupt, or multiple reasons -- falls through to the full trace).
  if (cause.reasons.length !== 1) {
    return undefined;
  }
  const reason = cause.reasons[0];
  if (reason === undefined || !Cause.isFailReason(reason)) {
    return undefined;
  }

  const error = reason.error;
  if (!isTaggedMessageError(error)) {
    return undefined;
  }

  const suggestion = KNOWN_ERROR_SUGGESTIONS[error._tag];
  if (suggestion === undefined) {
    return undefined;
  }

  return `skillmaker: ${error.message}\n  (${suggestion} -- re-run with --debug for the full stack trace)\n`;
};

/** The stderr text main.ts's catchCause should use for a given cause + debug setting. */
export const renderFailure = (cause: Cause.Cause<unknown>, debug: boolean): string => {
  if (!debug) {
    const known = formatKnownFailure(cause);
    if (known !== undefined) {
      return known;
    }
  }
  return `skillmaker: unexpected error\n${Cause.pretty(cause)}\n`;
};
