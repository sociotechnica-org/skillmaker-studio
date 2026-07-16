---
type: Surface
prefLabel: Lab
context: board
status: new
links:
  contains:
    - "./Entity - Todo"
  derived_from:
    - "../production/Mechanism - Bundle Stage"
    - "../evals/Economy - Coverage"
  related_to:
    - "./Surface - Board"
    - "./Surface - Activity Feed"
    - "../_index/Vision - Board Lab Ship Receive"
    - "../production/Entity - Skill Bundle"
---

## WHAT

The hardening bench (was `Catalog`, #64): "can I trust this under
pressure?" for every skill that already exists. As of issue #83 it is one
surface with two deep-linkable modes, `Lab` in `packages/viewer/src/app/
components/Lab.tsx` at the viewer's `/lab` route (aliases: `/catalog`):

- **Bench** (default) -- the triage list: one row per bundle, reordered
  for attention. This is the pre-#83 Lab, now also carrying an open-work
  signal.
- **Queue** (`/lab?view=queue`) -- "to-do mode": the whole workspace's
  todos as a flat, priority-sorted list, a bookmarkable place instead of a
  popup. This is the retired `TodosPanel`'s powers, moved here wholesale.

The mode, and an optional per-bundle filter, are a URL query, not a path
segment -- `?view=queue&bundle=<slug>` -- parsed by `runtime/router.tsx`'s
`parseRoute` into `Route`'s `lab` variant (`{ name: "lab", view, bundle }`)
and built back by `labHref(view, bundle?)`. Old bare `/lab` and `/catalog`
links are untouched: no `view` param parses to `"bench"`, exactly what
those URLs always rendered.

## WHY

Director ruling (2026-07-15, #80 -- "stock and flow"): **the Lab is the
stock view** -- the portfolio under care, once a skill exists -- and the
todo queue is named directly as **the heart of the Lab**: *"the lab has
views -- you can look at the skills you're tuning and see their health and
what's being worked on... or there is just to-do mode: all the work to be
done, kind of like that pop-up."* Before this issue the todo queue instead
rendered in a persistent right rail mounted by `AppShell.tsx` on every
route -- the Board, Ship, Receive, Activity, a bundle's own page -- work
that has nothing to do with, say, reading the Activity feed. #83 gives the
queue its home and retires the rail (full ruling:
`../_index/Vision - Board Lab Ship Receive`; the todo/stage split:
`./Entity - Todo`).

## HOW

**Bench.** Each row (`LabRow` in `Lab.tsx`) shows name, stage badge, an
`Archived` badge, a drift pill (only for the three `Drift` values that
mean something moved, #65), a one-liner, tags, latest recorded version,
a three-state coverage line, and -- new in #83 -- an open-work chip
("N open") whenever `entry.openTodoCount > 0`, linking into Queue filtered
to that bundle (`labHref("queue", entry.slug)`).

`orderForAttention` (`runtime/labOrder.ts`) learned a new rank alongside
the drift/coverage ranks #65 shipped: **drifted (0) < open todos (1) <
measurement gaps (2) < clean (3)**, archived always last regardless of the
above. Open work outranks a measurement gap on purpose -- a todo is a
concrete, already-scoped unit of work someone chose to write down; a
coverage gap is just an absence, nothing has been decided about it yet.
Ties keep the incoming order (`Array#sort` is stable, unit-tested in
`labOrder.test.ts`).

**The Unverified badge** (issue #93, `Mechanism - Receiving Dock.md` §HOW):
each row also carries an `Unverified` badge -- violet, deliberately NOT the
drift pill's amber, since this is "no proof," not "something moved" -- when
`entry.unverified` holds: the bundle arrived via the Receiving Dock
(`skill.routed`, an identity-granting disposition) and has never had a
graded measurement, at any recorded version. Cleared by our first graded
measurement, for good -- a later version bump never resurrects it. No
special case in `orderForAttention`: an Unverified row's
`measuredFixtureCount` is necessarily 0 (a subset of "zero ever" can't be
positive), so it always composes into the existing measurement-gap rank,
asserted directly in `labOrder.test.ts` rather than trusted by inspection.

`entry.openTodoCount` rides on `CatalogEntry` (`GET /api/catalog`): a
count of that bundle's non-terminal (not `done`/`wont-do`) todos, derived
at read time in `handleCatalog` (`packages/cli/src/server/Server.ts`) --
never stored. `rebuild()` (the same one this handler already runs once for
every bundle's fields) folds the journal's `todo.*` events into the
index's `todos` table; `handleCatalog` reads that table back via
`listTodos()` rather than re-reading and re-folding the journal a second
time -- one journal read for the whole request, same discipline as the
"ONE `rebuild()` for the whole request" rule above it. (The default
archived-excluded listing is exact: a todo can only be archived once
terminal, and terminal todos never count as open.)
**Deviation from the issue's illustrative row copy** ("3 open · 2 bugs"):
the issue's own data contract names a single derived count, so that's what
shipped -- a kind breakdown would need a second derived field
(`CatalogEntry` doesn't carry per-bundle todos, only the count) the issue
didn't ask for. Flagged here rather than invented; a follow-up issue can
add it if the bench wants the breakdown.

**Queue.** `Queue.tsx` is the former `TodosPanel.tsx`'s row/form/toggle
pieces, extracted rather than rewritten, rendered full-page instead of in
a collapsible `<aside>` (there's no longer a sibling route to share space
with): the flat priority-sorted list (`compareTodos`, data-model.md
§2.10), kind chips, the origin chip (#81, "from the field"; #86's bundle
chip sits alongside it), the status checkbox (`todo.status_changed`), the
add form (`todo.opened`), and the show-archived toggle. Two pure helpers
extracted alongside it live in `runtime/todoQueue.ts` -- `isDone` and
`filterTodosByBundle` -- unit-tested without React (`todoQueue.test.ts`),
the same `labOrder.ts` pattern. `filterTodosByBundle` is what Bench's
`?bundle=` link drives: Queue renders the filter as a visible, clearable
chip ("Filtered to `<slug>` -- showing N of M · Clear") rather than
silently hiding the rest of the workspace's work.

**Shell.** `AppShell.tsx` no longer mounts `<TodosPanel>` as a persistent
sibling on every route -- `TodosPanel.tsx` is deleted, its two capabilities
(read the queue, add a todo) both now live only in Queue. Quick capture
(the add-todo form) lives in Queue's add form, not shell chrome.

Deliberately not in this pass (mirrors the issue's own scope line): no
per-bundle Todos tab on bundle detail; no epics, grouping, or drag
re-prioritization; no new journal events -- this is presentation only, the
journal (`todo.*`, folded) was already the source of truth.

Verified: `packages/viewer/src/app/components/Lab.tsx` renders `ModeTabs`
(Bench/Queue) and switches between `Bench` (the pre-#83 row list plus the
open-work chip) and `<Queue bundleFilter={route.bundle} />`;
`packages/viewer/src/app/components/Queue.tsx` carries the kind-chip map,
`DEFAULT_PRIORITY_BY_KIND`, the add form, and the origin/bundle chips
forward from the deleted `TodosPanel.tsx` near-verbatim;
`packages/viewer/src/app/components/AppShell.tsx` no longer imports or
renders `TodosPanel`; `packages/viewer/src/app/runtime/labOrder.ts`'s
`attentionRank` checks `entry.openTodoCount > 0` between the drift check
and the coverage check; `packages/cli/src/server/Server.ts`'s
`handleCatalog` calls `index.listTodos()` after its one `rebuild()` and
sets
`openTodoCount: openTodoCountByBundle.get(bundle.slug) ?? 0` per entry;
`packages/viewer/src/app/runtime/router.tsx`'s `parseRoute` parses `/lab`'s
`?view=`/`?bundle=` query into the `lab` route variant and `labHref`
builds it back, both covered by `router.test.ts`'s round-trip case.
`packages/core/src/Verification.ts`'s `isUnverified`/`foldEverReceivedBundles`
and `IndexService.ts`'s `BundleRecord.everReceived` back `handleCatalog`'s
`unverified` field; `Lab.tsx`'s `LabRow` renders the badge next to the drift
pill; `labOrder.test.ts`'s dedicated composition test confirms no special
ordering case is needed.
