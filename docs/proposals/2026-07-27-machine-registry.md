# The Machine-Level Project Registry

*Proposal + build record — 2026-07-27. Implements the
[IA doc](2026-07-22-information-architecture.md) §A's "machine-level project
registry (later phase)". The rulings below were made by the director
in-session on 2026-07-27 and are recorded here as fixed; the design sections
record how this build satisfies them.*

## Director rulings (2026-07-27, in-session — fixed)

1. **The server runs per-machine.** Any port; multiple instances are
   technically fine. A single machine-level config lives at
   `~/.skillmaker-studio/config.json` listing PROJECTS, where each project
   is a directory on the machine (an existing skillmaker workspace: has
   `skillmaker.config.json` / `skills/` / `.skillmaker/`).
2. **`skillmaker start` serves the REGISTRY ONLY — it ignores cwd
   entirely.** Projects are added via the UI or an explicit CLI command
   (`skillmaker project add <path>` / `list` / `remove <path>`; remove only
   unregisters, never touches the directory).
3. **The UI can create new projects:** pick an EXISTING directory or CREATE
   a new one. A browser cannot yield absolute paths from native dialogs, so
   the server exposes a directory browser (the server reads the disk), a
   typed-path field with live validation, and a "create new folder here"
   action. The dialog's trigger stays abstract enough that a desktop-native
   dialog can replace the picker later without an API change.

## Invariants kept (from the IA doc)

- **Per-project data stays IN the project.** `skillmaker.config.json`,
  `skills/`, `.skillmaker/` journal + index stay per-directory. Cloning a
  project's repo still brings the skills *and their evidence* along.
- **The registry is ONLY a list:** `{ "projects": [{"path": "/abs/path"}] }`.
  A project's *name* is derived at read time from its own config (or its
  basename) — never duplicated into the registry. Missing/broken directories
  are reported per-project (`ok: false` + why), never crashed over.
- **One core module owns the registry:** `packages/core/src/MachineConfig.ts`
  — schema (`effect` Schema), atomic writes (temp file + rename), and the
  slug rule. `~/.skillmaker-studio` may later hold more machine state
  (app/window state, system skills); today it holds the registry and the
  server's claim file, nothing else.
- **`SKILLMAKER_STUDIO_HOME`** overrides the home directory, so tests (and
  parallel instances) never touch the real `~/.skillmaker-studio`.

## Registry shape

```json
{
  "projects": [
    { "path": "/Users/alice/code/my-skills" },
    { "path": "/Users/alice/code/client-work" }
  ]
}
```

Missing file = empty registry (first run). Malformed file = a loud typed
error (`MachineConfigMalformedError`) — silently treating a corrupt registry
as empty could lose every registered project on the next write.

## URL scheme (the clean break)

The viewer is the only client, so every workspace-scoped route moved to a
project-scoped shape in one break — no legacy aliases:

| Before | After |
| --- | --- |
| `/api/state`, `/api/bundles...`, `/api/events`, `/api/catalog`, `/api/todos`, `/api/skillbook`, `/api/field-reports`, `/api/intake`, `/api/adopt...`, `/api/chat/:skill/...` | `/api/projects/:project/<same>` |
| `/api/health` | unchanged (machine-level) |
| `/api/chat/providers` | unchanged (machine-level: providers are adapters on the machine; the capability probe borrows the first healthy project's workspace, empty registry ⇒ `{providers: []}`) |
| `/api/events-stream` | unchanged (ONE machine-level SSE stream; each journal message now carries `{"kind":"journal","project":"<slug>"}` — per-project watchers behind one stream) |
| — | `GET/POST /api/projects`, `DELETE /api/projects/:slug` (registry) |
| — | `GET /api/fs/list`, `GET /api/fs/validate`, `POST /api/fs/mkdir` (dialog support) |

Per-project server resources — chat session manager, run dispatch queue,
journal watcher — are keyed by registered project path and spun up/down as
the registry changes (no restart needed; the server also reconciles when the
registry file is edited by the CLI while it runs).

## Slug rule (deterministic, order-independent)

A project's URL slug is `slugify(basename(path))`. When two registered paths
would share that base slug, **every collider** gets
`-<first 8 hex of sha256(absolute path)>` appended. Order-independence is
the point: a registration-order `-2` suffix would let adding a project
silently rename another project's URLs. A project's slug never changes
unless a same-named sibling appears (accepted edge: the *first* project of a
colliding pair does change slug when the second arrives — unavoidable if
bare basenames are to stay pretty in the common case).

## The New-project dialog (viewer)

Step by step:

1. Sidebar "New project" opens the dialog (the trigger is a plain button —
   a desktop build can swap the picker for a native dialog behind it).
2. A typed **path field** validates live via `GET /api/fs/validate?path=`:
   absolute-only, reports `exists` / `isProject` / `registered` /
   `creatable` (parent exists).
3. A **directory browser** (`GET /api/fs/list?path=`) walks the server's
   disk: directories only (file names are never listed), dot-dirs skipped,
   projects flagged. Starts at `$HOME`.
4. **"New folder here"** (`POST /api/fs/mkdir {path}`) creates one level;
   parent must exist.
5. **Confirm** posts `POST /api/projects {path, create?, init?}`:
   - directory lacks `skillmaker.config.json` and no `init: true` →
     `409 {status: "needs_init"}`; the dialog asks "set this directory up as
     a skillmaker workspace?" and re-posts with `init: true`;
   - `init: true` scaffolds the default workspace via core
     `Workspace.init` — the same path `skillmaker init` uses (post-#174
     defaults included);
   - success registers the project and the sidebar refetches.

**Why a picker, not a native dialog:** browsers deliberately never reveal
absolute filesystem paths to pages (`<input type=file>` gives content, not
location). Since the server *is* local and already trusted with the disk,
the server-side browser is the honest equivalent — and the Tauri/desktop
future replaces the picker component with a native dialog that yields an
absolute path into the very same `POST /api/projects` call.

### Path safety (fs endpoints)

Absolute paths only; `resolve()` normalizes `..` away before any
filesystem touch; symlinks resolved via `realpathSync` before listing;
directories only — file names/contents are never served; mkdir is
single-level with an existing parent and refuses hidden names.

## CLI

- `skillmaker start [--port]` — registry-only (ruling 2). Default port 4323
  (the registry has no per-machine config yet). The single-instance claim
  file moved to `<home>/claims/server.json` (one per machine, with the
  registry). Empty registry starts fine and says how to add a project.
- `skillmaker project add <path>` — registers an existing workspace;
  refuses a non-workspace directory with a pointer to `skillmaker init`.
- `skillmaker project list` — slugs, health, paths (`--json` for machines).
- `skillmaker project remove <path>` — unregisters; never touches the
  directory.
- Every other per-workspace command (`init`, `new`, `run`, `advance`, …)
  keeps operating on **cwd** — they are the agent layer (D6), unchanged.

## Migration (no auto-migration magic)

Existing users run, once per workspace:

```
skillmaker project add /path/to/workspace
```

or add the directory via the UI's New-project dialog. Nothing else moves:
all per-project data stays where it was. The old per-workspace claim file
(`<project>/.skillmaker/claims/server.json`) is simply orphaned and can be
deleted.

## Testing

- `packages/core/test/MachineConfig.test.ts` — registry read/write/atomic
  semantics, home override, slug determinism/order-independence.
- `test/e2e/projects-endpoint.e2e.test.ts` — the live registry list +
  project-scoped resolution.
- `test/e2e/machine-registry.e2e.test.ts` — register/create/init at
  runtime, needs_init refusal, unregister-not-delete, broken-project
  reporting (503, `ok: false`), fs list/validate/mkdir safety, and the
  `project` CLI against an isolated home.
- The whole e2e harness moved to `startE2eRegistryServer` (temp
  `SKILLMAKER_STUDIO_HOME`, cwd auto-registered, per-project URL prefixes).
