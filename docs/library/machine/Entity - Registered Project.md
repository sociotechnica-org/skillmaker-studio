---
type: Entity
prefLabel: Registered Project
context: machine
status: new
links:
  conforms_to:
    - "./Mechanism - Machine Registry"
  related_to:
    - "../_index/Concept - Skillmaker Studio"
    - "../production/Entity - Skill Bundle"
---

## WHAT

A project is a directory on the machine that is a skillmaker workspace —
it has `skillmaker.config.json`, `skills/`, and `.skillmaker/` — and is
listed in the [[Mechanism - Machine Registry|machine registry]]. The
registry entry is nothing but the path: the project's name, skills,
journal, and bundles all live in the directory itself, so a project is
portable (clone the repo, register the path on the new machine) and
removable (`skillmaker project remove` unregisters, never deletes).

## WHY

Pre-registry, "the workspace" was implicit — whatever directory you ran
`skillmaker start` in. Making projects explicit, machine-registered
entities is what lets one server serve many projects at once, lets the
viewer offer a project switcher and a New-project dialog, and keeps the
door open for the desktop app (a native folder picker feeding the same
`POST /api/projects` call). The name-derivation rule (config `name`, else
basename — never stored in the registry) means the registry can never
disagree with the project about what it's called.

## HOW

- **API scope:** every project-scoped route lives under
  `/api/projects/:project/<resource>` — state, bundles, events, catalog,
  todos, skillbook, field-reports, intake, adopt, chat. Machine-level
  routes stay unprefixed: `/api/health`, `/api/chat/providers`,
  `/api/events-stream` (one SSE stream; journal messages carry the
  project slug), and the registry itself (`GET/POST /api/projects`,
  `DELETE /api/projects/:slug`).
- **Slug rule** (deterministic, order-independent): the URL slug is
  `slugify(basename(path))`; when two registered paths would collide,
  **every collider** gets `-<first 8 hex of sha256(absolute path)>`
  appended — a registration-order suffix would let adding a project
  silently rename another project's URLs. Accepted edge: the first
  project of a colliding pair does change slug when the second arrives.
- **Health:** a registered path that is missing or broken is reported
  per-project (`ok: false` + why, 503 on its routes), never crashed
  over; `skillmaker project list` shows the same health.

Verified: `packages/core/src/MachineConfig.ts` (slug rule with the
sha256-suffix collision handling, name derivation) and the route table in
`docs/proposals/2026-07-27-machine-registry.md` (the one-break URL
scheme); machine-level `/api/chat/providers` confirmed unprefixed in
`packages/cli/src/server/Server.ts`.
