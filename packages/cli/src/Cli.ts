/**
 * Argument parsing + command routing. Kept as a pure Effect so `main.ts` is
 * the only place that touches the runtime edge (Effect.runPromise / BunRuntime).
 */
import { Effect } from "effect";
import { type CliResult, ok, usageError } from "./CliResult.ts";
import { runAdvance } from "./commands/Advance.ts";
import { runBookBuild } from "./commands/BookBuild.ts";
import { runFixtureAdd } from "./commands/FixtureAdd.ts";
import { runGrade } from "./commands/Grade.ts";
import { runInit } from "./commands/Init.ts";
import { runList } from "./commands/List.ts";
import { runMeasurements } from "./commands/Measurements.ts";
import { runNew } from "./commands/New.ts";
import { runPublish } from "./commands/Publish.ts";
import { runReindex } from "./commands/Reindex.ts";
import { runReviewRequest } from "./commands/ReviewRequest.ts";
import { runRun } from "./commands/Run.ts";
import { runStart } from "./commands/Start.ts";
import { runStationRun } from "./commands/StationRun.ts";
import { runStatus } from "./commands/Status.ts";
import { runTodoAdd, runTodoList, runTodoStatus, type TodoStatusCommand } from "./commands/Todo.ts";
import { runVersionRecord } from "./commands/Version.ts";

const USAGE = `skillmaker — Skillmaker Studio CLI

Usage: skillmaker <command> [options]

Commands:
  init              Initialize a skillmaker workspace in the current directory
  new <slug>        Create a new Skill Bundle under skills/<slug>/
  list              List Skill Bundles by stage/substate (rebuilds the index first)
  status <slug>     Show one Skill Bundle's identity, state, and event history
  reindex           Rebuild .skillmaker/studio.db from files + the journal
  fixture add <slug> <case>   Scaffold evals/fixtures/<case>/ for a bundle
  run <slug>        Run a fixture case through an ACP provider (data-model.md §2.8)
  station run <slug>     Run an agent station for a bundle (data-model.md §2.13)
  grade <slug> <runId>    Record a run's grading verdict (data-model.md §2.9)
  measurements <slug>     Show measurement cells: n, pass rate, CI, guidance (§2.11)
  start             Serve the viewer + API (default port from config, or 4323)
  review request <slug>   Request review of the bundle's current stage work
  advance <slug>          Move a bundle along the state machine (guarded)
  version record <slug>   Record a version: hash design.md + output/ (idempotent on content)
  publish <slug>          Publish a bundle to its configured publishTargets (§2.14)
  book build              Render the Skillbook to a static site (§2.14)
  todo add <title>        Open a new todo
  todo list               List todos (rebuilds the index first)
  todo done <id>          Mark a todo done
  todo start <id>         Mark a todo in-progress
  todo drop <id>          Mark a todo won't-do
  todo reopen <id>        Reopen a terminal todo

Options:
  --json            Emit machine-readable JSON instead of text
  --name <name>     (new) Display name for the bundle; defaults to a title-cased slug
  --port <n>        (start) Port to serve on; overrides skillmaker.config.json
  --no-open         (start) Do not open a browser on startup
  --question <text> (review request) Question for the reviewer
  --label <text>    (version record) Human tag for the recorded version, e.g. "v0.3"
  --target <id>     (publish) Publish-target id from skillmaker.config.json; defaults to all configured
  --out <dir>       (book build) Output directory; defaults to .skillmaker/skillbook/
  --to <stage>      (advance) Target stage; defaults to the next stage
  --back <stage>    (advance) Move backward to an earlier stage (requires --reason)
  --reason <text>   (advance) Reason for a backward move
  --override        (advance) Bypass guards (journaled as a manual override)
  --kind <kind>     (todo add) task | bug | improvement | eval; defaults to task
  --bundle <slug>   (todo add/list) associate/filter by a bundle slug
  --detail <text>   (todo add) free-text detail
  --priority <n>    (todo add) lower = more urgent; defaults by kind
  --pin             (todo add) pin the todo (exempt from auto-archive)
  --all             (todo list) include archived todos
  --class <class>   (fixture add) golden | refusal | empty | rerun | hard-case | trigger; defaults to golden
  --risks <ids>     (fixture add) comma-separated risk-map ids, e.g. IN-1,RE-2
  --fixture <case>  (run) the fixture case to run (required)
  --provider <id>   (run, station run) provider id from skillmaker.config.json; defaults to "claude-code"
  --timeout <s>     (run, station run) prompt timeout in seconds; defaults to 300
  --state <state>   (station run) the state to run a station for; defaults to the bundle's current stage
  --verdict <v>     (grade) pass | fail | partial (required)
  --notes <text>    (grade) free-text grading notes
  -h, --help        Show this help

Exit codes (run): 0 completed, 1 failed, 2 usage error, 3 infra-error
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
const VALUE_FLAGS = new Set([
  "--name",
  "--port",
  "--question",
  "--to",
  "--back",
  "--reason",
  "--kind",
  "--bundle",
  "--detail",
  "--priority",
  "--label",
  "--class",
  "--risks",
  "--fixture",
  "--provider",
  "--timeout",
  "--verdict",
  "--notes",
  "--state",
  "--target",
  "--out",
]);

/** The first two positional arguments at or after `startIndex`, e.g. `<slug> <case>`. */
const twoPositionalsAfter = (
  argv: ReadonlyArray<string>,
  startIndex: number,
): readonly [string | undefined, string | undefined] => {
  const found: string[] = [];
  for (let i = startIndex; i < argv.length && found.length < 2; i++) {
    const arg = argv[i];
    if (arg === undefined || arg.startsWith("-")) {
      continue;
    }
    const prev = argv[i - 1];
    if (prev !== undefined && VALUE_FLAGS.has(prev)) {
      continue;
    }
    found.push(arg);
  }
  return [found[0], found[1]];
};

const TODO_STATUS_COMMANDS: ReadonlySet<string> = new Set(["done", "start", "drop", "reopen"]);

const isTodoStatusCommand = (value: string): value is TodoStatusCommand =>
  TODO_STATUS_COMMANDS.has(value);

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
    case "fixture": {
      const subcommand = argv[1];
      if (subcommand !== "add") {
        return usageError(
          `skillmaker: unknown "fixture" subcommand "${String(subcommand)}"\n\nUsage: skillmaker fixture add <slug> <case> [--class <class>] [--risks IN-1,RE-2]\n`,
        );
      }
      const [slug, caseName] = twoPositionalsAfter(argv, 2);
      const klass = flagValue(argv, "--class");
      const risks = flagValue(argv, "--risks");
      return yield* runFixtureAdd(cwd, slug, caseName, { json, klass, risks });
    }
    case "run": {
      const slug = positionalAfterCommand(argv);
      const fixture = flagValue(argv, "--fixture");
      const provider = flagValue(argv, "--provider");
      const timeout = flagValue(argv, "--timeout");
      return yield* runRun(cwd, slug, { json, fixture, provider, timeout });
    }
    case "station": {
      const subcommand = argv[1];
      if (subcommand !== "run") {
        return usageError(
          `skillmaker: unknown "station" subcommand "${String(subcommand)}"\n\nUsage: skillmaker station run <slug> [--state <state>] [--provider <id>] [--timeout <seconds>]\n`,
        );
      }
      const slug = positionalAfter(argv, 2);
      const state = flagValue(argv, "--state");
      const provider = flagValue(argv, "--provider");
      const timeout = flagValue(argv, "--timeout");
      return yield* runStationRun(cwd, slug, { json, state, provider, timeout });
    }
    case "grade": {
      const [slug, runId] = twoPositionalsAfter(argv, 1);
      const verdict = flagValue(argv, "--verdict");
      const notes = flagValue(argv, "--notes");
      return yield* runGrade(cwd, slug, runId, { json, verdict, notes });
    }
    case "measurements": {
      const slug = positionalAfterCommand(argv);
      return yield* runMeasurements(cwd, slug, { json });
    }
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
    case "version": {
      const subcommand = argv[1];
      if (subcommand !== "record") {
        return usageError(
          `skillmaker: unknown "version" subcommand "${String(subcommand)}"\n\nUsage: skillmaker version record <slug> [--label <text>]\n`,
        );
      }
      const slug = positionalAfter(argv, 2);
      const label = flagValue(argv, "--label");
      return yield* runVersionRecord(cwd, slug, { json, label });
    }
    case "publish": {
      const slug = positionalAfterCommand(argv);
      const target = flagValue(argv, "--target");
      return yield* runPublish(cwd, slug, { json, target });
    }
    case "book": {
      const subcommand = argv[1];
      if (subcommand !== "build") {
        return usageError(
          `skillmaker: unknown "book" subcommand "${String(subcommand)}"\n\nUsage: skillmaker book build [--out <dir>]\n`,
        );
      }
      const out = flagValue(argv, "--out");
      return yield* runBookBuild(cwd, { json, out });
    }
    case "todo": {
      const subcommand = argv[1];
      if (subcommand === "add") {
        const title = positionalAfter(argv, 2);
        const kind = flagValue(argv, "--kind");
        const bundle = flagValue(argv, "--bundle");
        const detail = flagValue(argv, "--detail");
        const priority = flagValue(argv, "--priority");
        return yield* runTodoAdd(cwd, title, {
          json,
          kind,
          bundle,
          detail,
          priority,
          pin: hasFlag(argv, "--pin"),
        });
      }
      if (subcommand === "list") {
        const bundle = flagValue(argv, "--bundle");
        return yield* runTodoList(cwd, { json, bundle, all: hasFlag(argv, "--all") });
      }
      if (subcommand !== undefined && isTodoStatusCommand(subcommand)) {
        const id = positionalAfter(argv, 2);
        return yield* runTodoStatus(cwd, subcommand, id, { json });
      }
      return usageError(
        `skillmaker: unknown "todo" subcommand "${String(subcommand)}"\n\nUsage: skillmaker todo add|list|done|start|drop|reopen ...\n`,
      );
    }
    default: {
      const result: CliResult = usageError(`skillmaker: unknown command "${command}"\n\n${USAGE}`);
      return result;
    }
  }
});
