/**
 * Argument parsing + command routing. Kept as a pure Effect so `main.ts` is
 * the only place that touches the runtime edge (Effect.runPromise / BunRuntime).
 */
import { Effect } from "effect";
import { type CliResult, ok, usageError } from "./CliResult.ts";
import { runInit } from "./commands/Init.ts";
import { runNew } from "./commands/New.ts";

const USAGE = `skillmaker — Skillmaker Studio CLI

Usage: skillmaker <command> [options]

Commands:
  init              Initialize a skillmaker workspace in the current directory
  new <slug>        Create a new Skill Bundle under skills/<slug>/

Options:
  --json            Emit machine-readable JSON instead of text
  --name <name>     (new) Display name for the bundle; defaults to a title-cased slug
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
    if (prev === "--name") {
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
    default: {
      const result: CliResult = usageError(`skillmaker: unknown command "${command}"\n\n${USAGE}`);
      return result;
    }
  }
});
