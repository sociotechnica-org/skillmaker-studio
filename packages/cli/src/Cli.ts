/**
 * Argument parsing + command routing. Kept as a pure Effect so `main.ts` is
 * the only place that touches the runtime edge (Effect.runPromise / BunRuntime).
 */
import { Effect } from "effect";
import { type CliResult, ok, usageError } from "./CliResult.ts";
import { runAdopt, runAdoptFromManifest, runAdoptTriage } from "./commands/Adopt.ts";
import { runAdvance } from "./commands/Advance.ts";
import { runBookBuild } from "./commands/BookBuild.ts";
import { runDossier } from "./commands/Dossier.ts";
import { runFixtureAdd } from "./commands/FixtureAdd.ts";
import { runFixtureHarvest } from "./commands/FixtureHarvest.ts";
import { runGrade } from "./commands/Grade.ts";
import { runInit } from "./commands/Init.ts";
import { runList } from "./commands/List.ts";
import { runMeasurements } from "./commands/Measurements.ts";
import { runNew } from "./commands/New.ts";
import { runPublish } from "./commands/Publish.ts";
import { runReceive } from "./commands/Receive.ts";
import { runReindex } from "./commands/Reindex.ts";
import { runReport } from "./commands/Report.ts";
import { runRoute } from "./commands/Route.ts";
import { runReviewRequest } from "./commands/ReviewRequest.ts";
import { runReviewResolve } from "./commands/ReviewResolve.ts";
import { runRun } from "./commands/Run.ts";
import { runRunRepair } from "./commands/RunRepair.ts";
import { runShip } from "./commands/Ship.ts";
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
  adopt [path]      Import pre-existing SKILL.md files under path (default cwd) as in-place bundles (--source <url-or-path> [--ref <ref>] to record upstream provenance for this batch); challenges provable arrivals instead of silently adopting them (issue #92)
  adopt --triage [path]   Sweep without acting: write adopt-manifest.md at the workspace root, one row per discovered skill (issue #92)
  adopt --from-manifest [file]   Execute a triage manifest (default adopt-manifest.md at the workspace root) as individual acts (issue #92)
  list              List Skill Bundles by stage/substate (rebuilds the index first)
  status <slug>     Show one Skill Bundle's identity, state, and event history
  reindex           Rebuild .skillmaker/studio.db from files + the journal
  fixture add <slug> <case>   Scaffold evals/fixtures/<case>/ for a bundle
  fixture harvest <slug> <case>   Turn a skill.field_report event into a Lab fixture (--from-report <event-id> required, issue #68)
  dossier <slug>    Print a bundle's dossier.md: job, contexts, out-of-scope, basis, evidence, fit criterion -- honest gaps shown as "unrecorded" (issue #94)
  run <slug>        Run a fixture case through an ACP provider (data-model.md §2.8)
  run repair <slug> [runId]   Terminal-state stuck "running" run(s) whose process is gone, so their transcripts become gradeable
  station run <slug>     Run an agent station for a bundle (data-model.md §2.13)
  grade <slug> <runId>    Record a run's grading verdict (data-model.md §2.9)
  measurements <slug>     Show measurement cells: n, pass rate, CI, guidance (§2.11)
  start             Serve the viewer + API (default port from config, or 4323)
  review request <slug>   Request review of the bundle's current stage work
  review resolve <slug>   Resolve a review (approve|revise) -- same journal path as the panel; no browser required
  advance <slug>          Move a bundle along the state machine (guarded)
  version record <slug>   Record a version: hash design.md + output/ (idempotent on content)
  publish <slug>          Publish a bundle to its configured publishTargets (§2.14)
  ship <slug>             Ship a recorded version to a destination, with its measurement receipts snapshotted (§2.9, issue #66)
  report <slug>           Record a field report on a shipped skill -- what the wild says back (§2.9, issue #67)
  receive <path>          Receive an arriving skill crate at the dock: copy it to receiving/<intake-id>/ and record skill.received (§2.9, issue #90)
  route <intake-id>       Route a received crate through one of the five exit doors: --as return|new|upgrade|fork|salvage --reason <text> (§2.9, issue #91)
  book build              Render the Skillbook to a static site (§2.14)
  todo add <title>        Open a new todo (--from-report <event-id> to seed it from a skill.field_report, issue #81)
  todo list               List todos (rebuilds the index first)
  todo done <id>          Mark a todo done
  todo start <id>         Mark a todo in-progress
  todo drop <id>          Mark a todo won't-do
  todo reopen <id>        Reopen a terminal todo

Options:
  --json            Emit machine-readable JSON instead of text
  --name <name>     (new) Display name for the bundle; defaults to a title-cased slug
                    (route) --as new/fork: display-name override; --as upgrade: version label override
  --port <n>        (start) Port to serve on; overrides skillmaker.config.json
  --no-open         (start) Do not open a browser on startup
  --question <text> (review request) Question for the reviewer
  --decision <d>    (review resolve) approve | revise (required)
  --label <text>    (version record) Human tag for the recorded version, e.g. "v0.3"
  --source <s>      (adopt) URL or local path this batch was imported from; recorded on each adopted skill's marker
                    (receive) Free-text: where the crate came from; defaults to the given <path> when omitted
  --ref <ref>       (adopt) Ref/tag/pointer alongside --source; ignored without --source
                    (receive) Ref/tag/pointer alongside --source; optional
  --triage          (adopt) Sweep and write adopt-manifest.md at the workspace root; acts on nothing (issue #92)
  --from-manifest [file]  (adopt) Execute a triage manifest as individual acts; defaults to adopt-manifest.md at the workspace root (issue #92)
  --target <id>     (publish) Publish-target id from skillmaker.config.json; defaults to all configured
  --purpose <text>  (ship) Free-text reason the skill is shipping, e.g. "eval harness for team X"
  --version <hash>  (ship, report) Recorded version hash-prefix; ship defaults to the latest recorded version, report leaves it unset when omitted
  --outcome <o>     (report) worked | failed | surprise (required)
  --note <text>     (report) Free-text field report (required)
  --from <dest>     (report) Where the report came from, e.g. "acme-agent-fleet"; optional
  --claimed-name <name>      (receive) The maker's claimed name for the arriving skill; optional
  --claimed-version <v>      (receive) A label or hash the maker claims this version is; optional
  --rights <r>      (receive) ours | licensed | unclear; optional, recorded never enforced
  --as <d>          (route) return | new | upgrade | fork | salvage (required)
  --parent <slug>   (route) the parent bundle slug (required for --as fork)
  --from-intake <id>   (fixture harvest) the skill.received intake id to harvest, alternative to --from-report (issue #91)
                    (todo add) the skill.received intake id to seed the todo from, alternative to --from-report (issue #91)
  --out <dir>       (book build) Output directory; defaults to .skillmaker/skillbook/
  --to <stage>      (advance) Target stage; defaults to the next stage
                    (ship) Destination the skill is shipping to, e.g. "acme-agent-fleet"
  --back <stage>    (advance) Move backward to an earlier stage (requires --reason)
  --reason <text>   (advance) Reason for a backward move
                    (route) The hypothesis (broken? evolved? forked?) -- required on every disposition
  --override        (advance) Bypass guards (journaled as a manual override)
  --kind <kind>     (todo add) task | bug | improvement | eval; defaults to task
  --bundle <slug>   (todo add/list) associate/filter by a bundle slug
                    (route) --as return/upgrade: the existing bundle routed against (required); --as new/fork: optional slug override for the minted bundle; --as salvage: optional bundle being defended
  --detail <text>   (todo add) free-text detail
  --priority <n>    (todo add) lower = more urgent; defaults by kind
  --pin             (todo add) pin the todo (exempt from the sweep)
  --all             (todo list) include swept todos
  --class <class>   (fixture add) golden | refusal | empty | rerun | hard-case | trigger; defaults to golden
                    (fixture harvest) same enum; defaults to hard-case
  --risks <ids>     (fixture add) comma-separated risk-map ids, e.g. IN-1,RE-2
  --context <name>  (fixture add) names a dossier.md Contexts entry this case exercises; optional, unvalidated (issue #94)
  --from-report <id>   (fixture harvest) the skill.field_report event id to harvest (required)
                    (todo add) the skill.field_report event id to seed the todo from (optional, issue #81); defaults --bundle/--kind/--detail from the report
  --fixture <case>  (run) the fixture case to run (required)
  --provider <id>   (run, station run) provider id from skillmaker.config.json; defaults to "claude-code"
  --model <id>      (run) model id from the provider's advertised session/new models.availableModels (e.g. "default", "sonnet", "haiku"); defaults to the provider's own default. Unknown ids are rejected with the advertised list.
  --timeout <s>     (run, station run) prompt timeout in seconds; defaults to 300
  --state <state>   (station run) the state to run a station for; defaults to the bundle's current stage
  --stage <stage>   (route) --as new/fork: entry stage for the minted bundle; defaults to "idea"
  --verdict <v>     (grade) pass | fail | partial (required)
  --notes <text>    (grade, review resolve) free-text notes
                    (receive) Free-text notes about the arriving crate; optional
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
  "--decision",
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
  "--context",
  "--from-report",
  "--fixture",
  "--provider",
  "--model",
  "--timeout",
  "--verdict",
  "--notes",
  "--state",
  "--target",
  "--out",
  "--source",
  "--ref",
  "--purpose",
  "--version",
  "--outcome",
  "--note",
  "--from",
  "--claimed-name",
  "--claimed-version",
  "--rights",
  "--as",
  "--parent",
  "--stage",
  "--from-intake",
  "--from-manifest",
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
    case "adopt": {
      const targetPath = positionalAfterCommand(argv);
      if (hasFlag(argv, "--triage")) {
        return yield* runAdoptTriage(cwd, targetPath, { json });
      }
      if (hasFlag(argv, "--from-manifest")) {
        const rawManifestFile = flagValue(argv, "--from-manifest");
        // `--from-manifest` takes an OPTIONAL file argument -- if the next
        // token is itself another flag (or absent), there is no explicit
        // file and `runAdoptFromManifest` falls back to its own default
        // (`adopt-manifest.md` at the workspace root).
        const manifestFile =
          rawManifestFile !== undefined && !rawManifestFile.startsWith("-") ? rawManifestFile : undefined;
        return yield* runAdoptFromManifest(cwd, manifestFile, { json });
      }
      const source = flagValue(argv, "--source");
      const ref = flagValue(argv, "--ref");
      return yield* runAdopt(cwd, targetPath, { json, source, ref });
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
      if (subcommand === "add") {
        const [slug, caseName] = twoPositionalsAfter(argv, 2);
        const klass = flagValue(argv, "--class");
        const risks = flagValue(argv, "--risks");
        const context = flagValue(argv, "--context");
        return yield* runFixtureAdd(cwd, slug, caseName, { json, klass, risks, context });
      }
      if (subcommand === "harvest") {
        const [slug, caseName] = twoPositionalsAfter(argv, 2);
        const klass = flagValue(argv, "--class");
        const fromReport = flagValue(argv, "--from-report");
        const fromIntake = flagValue(argv, "--from-intake");
        return yield* runFixtureHarvest(cwd, slug, caseName, { json, klass, fromReport, fromIntake });
      }
      return usageError(
        `skillmaker: unknown "fixture" subcommand "${String(subcommand)}"\n\nUsage: skillmaker fixture add <slug> <case> [--class <class>] [--risks IN-1,RE-2]\n       skillmaker fixture harvest <slug> <case> (--from-report <event-id> | --from-intake <intake-id>) [--class <class>]\n`,
      );
    }
    case "run": {
      if (argv[1] === "repair") {
        const [slug, runId] = twoPositionalsAfter(argv, 2);
        return yield* runRunRepair(cwd, slug, runId, { json });
      }
      const slug = positionalAfterCommand(argv);
      const fixture = flagValue(argv, "--fixture");
      const provider = flagValue(argv, "--provider");
      const model = flagValue(argv, "--model");
      const timeout = flagValue(argv, "--timeout");
      return yield* runRun(cwd, slug, { json, fixture, provider, model, timeout });
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
      if (subcommand === "request") {
        const slug = positionalAfter(argv, 2);
        const question = flagValue(argv, "--question");
        return yield* runReviewRequest(cwd, slug, { json, question });
      }
      if (subcommand === "resolve") {
        const slug = positionalAfter(argv, 2);
        const decision = flagValue(argv, "--decision");
        const notes = flagValue(argv, "--notes");
        return yield* runReviewResolve(cwd, slug, { json, decision, notes });
      }
      return usageError(
        `skillmaker: unknown "review" subcommand "${String(subcommand)}"\n\nUsage: skillmaker review request <slug> [--question <text>]\n       skillmaker review resolve <slug> --decision approve|revise [--notes <text>]\n`,
      );
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
    case "ship": {
      const slug = positionalAfterCommand(argv);
      const to = flagValue(argv, "--to");
      const purpose = flagValue(argv, "--purpose");
      const version = flagValue(argv, "--version");
      return yield* runShip(cwd, slug, { json, to, purpose, version });
    }
    case "report": {
      const slug = positionalAfterCommand(argv);
      const outcome = flagValue(argv, "--outcome");
      const note = flagValue(argv, "--note");
      const version = flagValue(argv, "--version");
      const from = flagValue(argv, "--from");
      return yield* runReport(cwd, slug, { json, outcome, note, version, from });
    }
    case "receive": {
      const targetPath = positionalAfterCommand(argv);
      const source = flagValue(argv, "--source");
      const ref = flagValue(argv, "--ref");
      const claimedName = flagValue(argv, "--claimed-name");
      const claimedVersion = flagValue(argv, "--claimed-version");
      const rights = flagValue(argv, "--rights");
      const notes = flagValue(argv, "--notes");
      return yield* runReceive(cwd, targetPath, {
        json,
        source,
        ref,
        claimedName,
        claimedVersion,
        rights,
        notes,
      });
    }
    case "route": {
      const intake = positionalAfterCommand(argv);
      const as = flagValue(argv, "--as");
      const bundle = flagValue(argv, "--bundle");
      const parent = flagValue(argv, "--parent");
      const name = flagValue(argv, "--name");
      const stage = flagValue(argv, "--stage");
      const reason = flagValue(argv, "--reason");
      return yield* runRoute(cwd, intake, { json, as, bundle, parent, name, stage, reason });
    }
    case "dossier": {
      const slug = positionalAfterCommand(argv);
      return yield* runDossier(cwd, slug, { json });
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
        const fromReport = flagValue(argv, "--from-report");
        const fromIntake = flagValue(argv, "--from-intake");
        return yield* runTodoAdd(cwd, title, {
          json,
          kind,
          bundle,
          detail,
          priority,
          pin: hasFlag(argv, "--pin"),
          fromReport,
          fromIntake,
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
