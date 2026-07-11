/**
 * Argument parsing + command routing. Kept as a pure Effect so `main.ts` is
 * the only place that touches the runtime edge (Effect.runPromise / BunRuntime).
 */
import { Effect } from "effect";
import { type CliResult, ok, usageError } from "./CliResult.ts";
import { runAdvance } from "./commands/Advance.ts";
import { runInit } from "./commands/Init.ts";
import { runList } from "./commands/List.ts";
import { runNew } from "./commands/New.ts";
import { runReindex } from "./commands/Reindex.ts";
import { runReviewRequest } from "./commands/ReviewRequest.ts";
import { runStart } from "./commands/Start.ts";
import { runStatus } from "./commands/Status.ts";

const USAGE = `skillmaker — Skillmaker Studio CLI

Usage: skillmaker <command> [options]

Commands:
  init              Initialize a skillmaker workspace in the current directory
  new <slug>        Create a new Skill Bundle under skills/<slug>/
  list              List Skill Bundles by stage/substate (rebuilds the index first)
  status <slug>     Show one Skill Bundle's identity, state, and event history
  reindex           Rebuild .skillmaker/studio.db from files + the journal
  start             Serve the viewer + API (default port from config, or 4323)
  review request <slug>   Request review of the bundle's current stage work
  advance <slug>          Move a bundle along the state machine (guarded)

Options:
  --json            Emit machine-readable JSON instead of text
  --name <name>     (new) Display name for the bundle; defaults to a title-cased slug
  --port <n>        (start) Port to serve on; overrides skillmaker.config.json
  --no-open         (start) Do not open a browser on startup
  --question <text> (review request) Question for the reviewer
  --to <stage>      (advance) Target stage; defaults to the next stage
  --back <stage>    (advance) Move backward to an earlier stage (requires --reason)
  --reason <text>   (advance) Reason for a backward move
  --override        (advance) Bypass guards (journaled as a manual override)
  -h, --help        Show this help
`;

const hasFlag = (argv: ReadonlyArray<string>, flag: string): boolean => argv.includes(flag);

const flagValue = (argv: ReadonlyArray<string>, flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
};

/** Flags across every command that consume the following argv slot as a value. */
const VALUE_FLAGS = new Set(["--name", "--port", "--question", "--to", "--back", "--reason"]);

/**
 * The first positional (non-flag, not-a-flag-value) argument at or after
 * `startIndex`. `startIndex` lets multi-word commands (e.g. `review
 * request <slug>`) skip their own subcommand token.
 */
const positionalAfter = (argv: ReadonlyArray<string>, startIndex: number): string | undefined => {
  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || arg.startsWith("-")) {
      continue;
    }
    // Skip values consumed by a preceding option flag.
    const prev = argv[i - 1];
    if (prev !== undefined && VALUE_FLAGS.has(prev)) {
      continue;
    }
    return arg;
  }
  return undefined;
};

const positionalAfterCommand = (argv: ReadonlyArray<string>): string | undefined =>
  positionalAfter(argv, 1);

export const run = Effect.fn("Cli.run")(function* (argv: ReadonlyArray<string>, cwd: string) {
  const command = argv[0];
  const json = hasFlag(argv, "--json");

  if (command === undefined || command === "--help" || command === "-h") {
    return ok(USAGE);
  }

  switch (command) {
    case "init":
      return yield* runInit(cwd, { json });
    case "new": {
      const slug = positionalAfterCommand(argv);
      const name = flagValue(argv, "--name");
      return yield* runNew(cwd, slug, { json, name });
    }
    case "list":
      return yield* runList(cwd, { json });
    case "status": {
      const slug = positionalAfterCommand(argv);
      return yield* runStatus(cwd, slug, { json });
    }
    case "reindex":
      return yield* runReindex(cwd, { json });
    case "start": {
      const portValue = flagValue(argv, "--port");
      const port = portValue === undefined ? undefined : Number.parseInt(portValue, 10);
      if (portValue !== undefined && (port === undefined || Number.isNaN(port))) {
        return usageError(`skillmaker start: invalid --port value "${portValue}"\n`);
      }
      return yield* runStart(cwd, { port, noOpen: hasFlag(argv, "--no-open") });
    }
    case "review": {
      const subcommand = argv[1];
      if (subcommand !== "request") {
        return usageError(
          `skillmaker: unknown "review" subcommand "${String(subcommand)}"\n\nUsage: skillmaker review request <slug> [--question <text>]\n`,
        );
      }
      const slug = positionalAfter(argv, 2);
      const question = flagValue(argv, "--question");
      return yield* runReviewRequest(cwd, slug, { json, question });
    }
    case "advance": {
      const slug = positionalAfterCommand(argv);
      const to = flagValue(argv, "--to");
      const back = flagValue(argv, "--back");
      const reason = flagValue(argv, "--reason");
      return yield* runAdvance(cwd, slug, { json, to, back, reason, override: hasFlag(argv, "--override") });
    }
    default: {
      const result: CliResult = usageError(`skillmaker: unknown command "${command}"\n\n${USAGE}`);
      return result;
    }
  }
});
