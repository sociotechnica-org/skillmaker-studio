---
type: Mechanism
prefLabel: Machine Registry
context: machine
status: new
links:
  contains:
    - "./Entity - Registered Project"
  related_to:
    - "../_index/Concept - Skillmaker Studio"
    - "./Concept - Hosted-ASAP Intent"
    - "../runs/Entity - Journal"
---

## WHAT

The machine-level list of projects the server serves: ONE file,
`~/.skillmaker-studio/config.json`, shape
`{ "projects": [{"path": "/abs/path"}] }`. `skillmaker start` serves the
**registry only — it ignores cwd entirely** (director ruling 1,
2026-07-27): the server runs per-machine, every
[[Entity - Registered Project|registered project]] is served at
`/api/projects/:project/...`, and an empty registry starts fine (the UI
can add the first project). This replaces the pre-registry model where
`start` served whatever workspace it was launched in.

## WHY

The IA doc's §A named the machine-level project registry as a later
phase; the director's 2026-07-27 rulings fixed it (recorded in
`docs/proposals/2026-07-27-machine-registry.md`). Two invariants carry
the design: **per-project data stays IN the project** —
`skillmaker.config.json`, `skills/`, the `.skillmaker/` journal and index
stay per-directory, so cloning a project's repo still brings the skills
and their evidence along — and **the registry is ONLY a list**: a
project's name is derived at read time from its own config (or its
basename), never duplicated into the registry; a missing or broken
directory is reported per-project (`ok: false` + why), never crashed
over. `~/.skillmaker-studio` may later hold more machine state (app or
window state, system skills); today it holds the registry and the
server's claim file, nothing else.

## HOW

`packages/core/src/MachineConfig.ts` is the one owning module: `effect`
Schema, atomic writes (temp file + rename), the slug rule, and
`MachineConfigMalformedError` (a missing file is an empty registry; a
corrupt one errors loudly rather than silently losing every registered
project on the next write). `SKILLMAKER_STUDIO_HOME` overrides the home
directory so tests and parallel instances never touch the real
`~/.skillmaker-studio`.

- CLI: `skillmaker project add <path>` (refuses a non-workspace directory
  with a pointer to `skillmaker init`), `project list` (slugs, health,
  paths, `--json`), `project remove <path>` (unregisters, never touches
  the directory). `skillmaker start [--port]` defaults to port 4323 — the
  registry has no per-machine config yet, and the single-instance claim
  file lives at `<home>/claims/server.json`. Every other per-workspace
  command (`init`, `new`, `run`, `advance`, …) keeps operating on cwd —
  they are the agent layer (D6), unchanged.
- Viewer: the New-project dialog picks an existing directory or creates
  one, via server-side fs endpoints (`GET /api/fs/list`,
  `GET /api/fs/validate`, `POST /api/fs/mkdir` — directories only,
  absolute paths only) — a browser cannot yield absolute paths from
  native dialogs, and the trigger stays abstract so a desktop-native
  dialog can replace the picker without an API change. A directory
  without `skillmaker.config.json` gets a `needs_init` refusal and an
  offered `init: true` scaffold via the same core `Workspace.init` path
  `skillmaker init` uses.
- Server resources — chat session manager, run dispatch queue, journal
  watcher — are keyed per registered project and spun up/down as the
  registry changes; `/api/events-stream` stays ONE machine-level SSE
  stream whose journal messages carry a `project` slug. Migration was
  deliberately manual: existing users run `skillmaker project add
  <path>` once per workspace; nothing else moves.

Verified: `packages/core/src/MachineConfig.ts` (file location, schema,
`SKILLMAKER_STUDIO_HOME` override, atomic-write and malformed-error doc
comments), `packages/cli/src/commands/Start.ts` ("serves the REGISTRY
ONLY: it ignores cwd entirely"; `DEFAULT_START_PORT = 4323`), and the
rulings/design against `docs/proposals/2026-07-27-machine-registry.md`.
