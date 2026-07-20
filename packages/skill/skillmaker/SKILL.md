---
name: skillmaker
description: Design, evaluate, and ship agent skills with receipts using Skillmaker Studio. Use when the user asks to set up Skillmaker in this repo, create/adopt/run/grade/ship a Skill Bundle, open the board, or otherwise work with the skillmaker CLI (init, new, start, run, grade, ship, publish, adopt).
---

You are a thin dispatcher onto the `skillmaker` CLI, not a reimplementation
of it. Every state-touching operation below -- anything that creates,
mutates, advances, or publishes a Skill Bundle -- is a real CLI invocation
you run, never logic you carry out yourself in prose. The CLI is the only
thing that writes to the append-only journal (`.skillmaker/events.jsonl`)
that the board and every other door read from; skipping it means your
change is invisible everywhere else.

## 1. Resolve the command

Prefer the binary if it's already on `PATH`:

```
skillmaker --help
```

If that fails (`command not found`), fall back to the zero-install door,
which resolves the same binary via npm:

```
npx skillmaker-studio --help
```

Use whichever one worked for every command below (substitute `skillmaker`
with `npx skillmaker-studio` throughout if that's the one that resolved).
Do not install anything else, do not shell out to `npm install -g`
yourself -- if neither resolves, tell the user their environment can't
reach npm and stop.

## 2. Command map

Run these verbatim (with the user's actual slug/args substituted); read
the command's stdout/stderr back to the user rather than summarizing it
away -- CLI output already carries the receipts (event ids, warnings,
next steps) this skill would otherwise have to reconstruct.

- **Set up this repo** (`/skillmaker init`): `skillmaker init`
  Initializes the workspace (`skillmaker.config.json`, `.skillmaker/`,
  `skills/`), then sweeps the repo for pre-existing skills in their normal
  spots and offers them for adoption -- this is "bring what you already
  have into the studio," not "create empty dirs." If the sweep finds
  candidates, it writes `adopt-manifest.md` at the workspace root and
  prints how many rows it found; tell the user to review that file, then
  run:
  ```
  skillmaker adopt --from-manifest
  ```
  to execute it. `init` always ends its own output with one explicit next
  action line -- surface that line to the user verbatim, it is the single
  most useful thing to say next.

- **Create a new Skill Bundle** (`/skillmaker new <slug>`):
  `skillmaker new <slug> [--name <display name>]`

- **Adopt existing `SKILL.md` files** (bulk, no triage step):
  `skillmaker adopt [path]` -- or, to review before acting,
  `skillmaker adopt --triage [path]` then edit `adopt-manifest.md` and run
  `skillmaker adopt --from-manifest`.

- **Open the board** (`/skillmaker start`): `skillmaker start [--port <n>] [--no-open]`
  Serves the viewer + API on one origin (default `http://localhost:4323`).
  This is a long-running process -- if you're driving it for the user,
  say so and don't block on it finishing; report the URL and move on.

- **Run a fixture case through an agent provider** (`/skillmaker run`):
  `skillmaker run <slug> --fixture <case> [--provider claude-code|codex] [--model <id>]`

- **Grade a run** (`/skillmaker grade`):
  `skillmaker grade <slug> <runId> --verdict pass|fail|partial [--notes <text>]`

- **Ship a recorded version** (`/skillmaker ship`):
  `skillmaker ship <slug> --to <destination> [--purpose <text>] [--version <hash>]`
  (needs a recorded version first: `skillmaker version record <slug>`)

- **Publish to a configured target** (`/skillmaker publish`):
  `skillmaker publish <slug> [--target <id>]`

- **Everything else** -- `list`, `status <slug>`, `dossier <slug>`,
  `measurements <slug>`, `review request|resolve`, `advance`,
  `version record`, `book build`, `todo add|list|done|start|drop|reopen`,
  `receive`, `route` -- maps 1:1 the same way. Run `skillmaker --help` for
  the full flag reference rather than guessing a flag's name or default.

## 3. Rules

- **Never write `bundle.json`, `design.md`, journal events, or any other
  Skillmaker-owned file directly.** If a task looks like "update this
  bundle's stage" or "record a version," that is a CLI command
  (`advance`, `version record`), not a file edit -- editing the files
  yourself desyncs the journal from the filesystem, which the CLI's own
  guards exist to prevent.
- **`design.md`, `research/`, and hand-written prose inside a bundle ARE
  yours to edit directly** -- those are authored content, not journal
  state. The line is: state (stage, versions, reviews, events) goes
  through the CLI; prose (design reasoning, research notes) is a normal
  file edit.
- If a command fails, show the user the actual error text and stop --
  don't retry with guessed flags, and don't paper over a usage error by
  inventing a workaround.
- If asked to do something with no CLI command for it, say so plainly
  instead of improvising a substitute action.
