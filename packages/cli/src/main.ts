#!/usr/bin/env bun
/**
 * skillmaker — CLI entry point.
 *
 * Walking-skeleton stub: prints name/version and the command list. Each
 * command below is a router slot only; implementations land brick by brick
 * (see docs/plan.md, "Build order").
 */

import pkg from "../package.json";

type CommandName = "init" | "new" | "start" | "run" | "version" | "reindex";

const COMMANDS: Record<CommandName, string> = {
  init: "Initialize a skillmaker workspace in the current directory",
  new: "Create a new Skill Bundle under skills/<slug>/",
  start: "Serve the viewer and /api on one origin",
  run: "Execute a fixture case against a provider and capture the run",
  version: "Record a skill version (content hash of output/)",
  reindex: "Rebuild the SQLite index from files + journal",
};

function printUsage(): void {
  console.log(`${pkg.name} ${pkg.version} — Skillmaker Studio CLI`);
  console.log();
  console.log("Usage: skillmaker <command> [options]");
  console.log();
  console.log("Commands:");
  for (const [name, description] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(10)} ${description}`);
  }
}

function main(argv: string[]): number {
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h") {
    printUsage();
    return 0;
  }

  switch (command as CommandName) {
    case "init":
      // TODO: scaffold skillmaker.config.json, skills/, .skillmaker/
      break;
    case "new":
      // TODO: create bundle dir + bundle.json, append bundle.created event
      break;
    case "start":
      // TODO: Bun.serve — static viewer dist/ + /api/*, claim-file ownership
      break;
    case "run":
      // TODO: fixture × version × provider via ACP subprocess, capture run
      break;
    case "version":
      // TODO: hash output/ tree, append skill.version_recorded event
      break;
    case "reindex":
      // TODO: rebuild SQLite index from files + journal replay
      break;
    default:
      console.error(`skillmaker: unknown command "${command}"`);
      printUsage();
      return 1;
  }

  console.log(`skillmaker ${command}: not implemented yet (foundations only)`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
