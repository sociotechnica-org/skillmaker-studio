/**
 * Argument parsing + command routing. Kept as a pure Effect so `main.ts` is
 * the only place that touches the runtime edge (Effect.runPromise / BunRuntime).
 */
import { Effect } from "effect";
import { type CliResult, ok, usageError } from "./CliResult.ts";
import { runInit } from "./commands/Init.ts";
import { runList } from "./commands/List.ts";
import { runNew } from "./commands/New.ts";
import { runReindex } from "./commands/Reindex.ts";
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

Options:
  --json            Emit machine-readable JSON instead of text
  --name <name>     (new) Display name for the bundle; defaults to a title-cased slug
  --port <n>        (start) Port to serve on; overrides skillmaker.config.json
  --no-open         (start) Do not open a browser on startup
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

const positionalAfterCommand = (argv: ReadonlyArray<string>): string | undefined => {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || arg.startsWith("-")) {
      continue;
    }
    // Skip values consumed by a preceding option flag.
    const prev = argv[i - 1];
    if (prev === "--name" || prev === "--port") {
      continue;
    }
    return arg;
  }
  return undefined;
};

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
    default: {
      const result: CliResult = usageError(`skillmaker: unknown command "${command}"\n\n${USAGE}`);
      return result;
    }
  }
});
