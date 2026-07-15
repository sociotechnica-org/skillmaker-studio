---
type: Entity
prefLabel: Field Report
context: outputs
status: new
links:
  related_to:
    - "../_index/Vision - Board Lab Ship Receive"
    - "./Entity - Shipment"
    - "./Entity - Skillbook"
    - "../evals/Entity - Fixture"
---

## WHAT

A record of what the wild says back about a skill: `skill.field_report` --
`{bundle, outcome, report, versionHash?, destination?}`, where
`outcome: "worked" | "failed" | "surprise"` is the reporter's own read (not
a pass/fail eval verdict) and `report` is free prose. It is the inbound
half of the checkout/return-record primitive the Board · Lab · Ship ·
Receive model names (`Vision - Board Lab Ship Receive.md` §HOW) --
`skill.shipped`'s (`Entity - Shipment.md`) counterpart. `versionHash` and
`destination` are both optional, unlike a shipment's required fields: the
reporter may not know which recorded version they ran or which shipment
they're reporting on -- when known, they tie the report back to a specific
`skill.shipped` record, but a report naming neither is still real, useful
signal. Like a shipment, a field report carries no `idempotencyKey`: two
reports about the same bundle are two distinct pieces of signal, never a
duplicate to collapse.

## WHY

Before this, the studio was a closed loop on the inbound side too: skills
left via `skill.shipped` (#71) with nothing to carry information back.
That gap matters for the same reason independence does -- shipped skills
change in the wild and generate signal the studio never sees unless
something records it, and "a skill that fails in production *is* a new
fixture" (`Vision - Board Lab Ship Receive.md` §WHY) is the best fixture
source the studio has. The sequencing was deliberate (§HOW): *"a dumb
inbound channel. Even a manually pasted field report proves the loop
closes once, by hand, before automating it."* This card is exactly that --
the smallest possible channel, not an intake pipeline. Turning a report
into a Lab fixture automatically is #68, a separate, later step; this
event only records that the report was made.

This is also why a field report is deliberately **not** a board-state
effect, same house rule `skill.shipped` follows: it isn't a stage change,
so `Fold.ts`'s `foldBundleStates` never branches on `skill.field_report` --
a report can land for a bundle in any stage without disturbing where it
sits on the Board or in the Lab.

`fixture harvest` (issue #68) is the other half of the sentence this card
opened with -- "a skill that fails in production *is* a new fixture." A
field report alone is prose; harvesting turns one specific report into one
`evals/fixtures/<case>/` directory a human named and classified themselves.
Deliberately not automatic: the event only records that the wild said
something, harvesting is a second, later, human decision about which
reports earned a fixture.

## HOW

CLI: `skillmaker report <slug> --outcome <worked|failed|surprise> --note
<text> [--version <hash-prefix>] [--from <destination>] [--json]`
(`packages/cli/src/commands/Report.ts`). Unlike `ship`, there is no
dedicated core module -- the only real logic is resolving an optional
`--version` hash-prefix, which reuses `resolveSkillVersion`
(`packages/core/src/Versions.ts`, hoisted out of `Ship.ts` in #71 for
exactly this reuse): the same left-anchored-prefix, newest-match-wins
semantics `ship` uses, erroring only when `--version` is given but matches
no recorded version. An *unset* `--version` is never an error, unlike
`ship`'s "nothing to ship" case -- the event's `versionHash` is optional
for exactly that reason.

Viewer: the Receive tab (`packages/viewer/src/app/components/Receive.tsx`,
a static empty state before this card) now renders a workspace-wide field-
report list, newest first (bundle · outcome badge · report text ·
version/destination when known · when), read from a small dedicated
aggregate, `GET /api/field-reports` (`packages/cli/src/server/Server.ts`) --
a read-time filter over the same full journal read every other endpoint
uses, no new SQLite table. A minimal paste form (bundle select + outcome
select + textarea) appends the event through the generic
`POST /api/events` path, `skill.field_report` newly added to
`ALLOWED_API_EVENT_TYPES` -- "the manually pasted channel, verbatim." The
Activity feed picks the event up automatically (it renders any event's
`payload.bundle`, not a fixed type list); Ship's per-bundle chapter
changelog (`packages/cli/src/Skillbook.ts#buildSkillbook`) gains a
`"reported"` entry type alongside `"shipped"`, hand-mirrored in the viewer's
`packages/viewer/src/app/runtime/schemas.ts` the same way `SkillbookShipment`
was.

## HOW -- harvest (issue #68)

CLI: `skillmaker fixture harvest <slug> <case> --from-report <event-id>
[--class <class>] [--json]` (`packages/cli/src/commands/FixtureHarvest.ts`).
Thin wrapper, same layering as `report`: the domain logic lives in core
(`harvestFixture`, `packages/core/src/Harvest.ts`), which resolves
`--from-report` against the full journal and fails honestly on every way
that can go wrong -- unknown event id (`HarvestEventNotFoundError`), an
event that exists but isn't a `skill.field_report`
(`HarvestNotFieldReportError`), a report naming a different bundle
(`HarvestWrongBundleError`), or a case-name collision
(`HarvestCaseExistsError`, the same rule `fixture add` enforces). On success
it writes the exact same scaffold `fixture add` does --
`writeFixtureScaffold` (`packages/core/src/Fixtures.ts`) is shared by both --
except `prompt.md` is seeded from the report's `report` prose verbatim
(the wild's own words, not a paraphrase) and `case.json` carries a new
optional `source: {kind: "field-report", eventId, destination?}` field, so
every fixture predating harvest keeps validating unchanged. Default class
`hard-case` (the wild's specialty); `--class` overrides to any of
`FIXTURE_CLASSES`. `risks` starts empty -- coverage, like grading, is a
human call the harvester fills in afterward. Fixtures stay files, not
events: harvesting only *reads* the journal to resolve `--from-report`, it
never appends.

Viewer: the Receive tab (`packages/viewer/src/app/components/Receive.tsx`)
closes the loop visibly, CLI-first -- no write button in this pass. A
harvested report's row links to its fixture on the bundle's Evals tab
(`bundleHref(slug, "evals")`); an unharvested `failed`/`surprise` report
shows the `fixture harvest` command as copyable text instead, `<case>` left
for the human to name. To tell the two apart, `GET /api/field-reports`
(`handleFieldReports`, `packages/cli/src/server/Server.ts`) now also scans
each reported bundle's fixtures (`IndexService.listFixtures`, the same
scanner every other fixture list reads) for a `source.eventId` match and
returns `fixtureCase: string | null` per report -- no new SQLite table, just
a `source_json` column added to the existing `fixtures` table (`IndexService.ts`).

Deliberately not built in this pass (`Vision - Board Lab Ship Receive.md`
§HOW sequencing, issue #68's own scope line): no auto-harvest, no batch
harvest, no grading inference from report text -- the human decides what the
wild taught. No new event types. No field-drift concept (a shipped version
diverging in the wild, distinct from today's local drift, `Mechanism - Drift
Hint.md`) -- Receive owns that, unbuilt. No intake/quarantine for *arriving*
skills -- a separate, design-needed issue.

Verified: `packages/core/src/Journal.ts` (`SkillFieldReportEvent`,
`FieldReportOutcome`), `packages/core/src/Fold.ts` (`bundleForEvent`'s
`"skill.field_report"` case, `foldBundleStates` untouched),
`packages/cli/src/commands/Report.ts`, `packages/cli/src/Skillbook.ts`
(the `"reported"` changelog branch), `packages/cli/src/server/Server.ts`
(`ALLOWED_API_EVENT_TYPES`, `handleFieldReports`, `GET /api/field-reports`),
and `packages/viewer/src/app/components/Receive.tsx` (the paste form,
`useFieldReports`) all present and match this description. Harvest (#68):
`packages/core/src/Harvest.ts` (`harvestFixture`, its four tagged errors),
`packages/core/src/Fixtures.ts` (`FixtureSource`, `FixtureCase.source`,
`writeFixtureScaffold`, `scanFixtures`'s tolerant `source` parsing),
`packages/core/src/IndexService.ts` (`fixtures.source_json`,
`FixtureRecord.source`), `packages/cli/src/commands/FixtureHarvest.ts`,
`packages/cli/src/Cli.ts` (`fixture harvest` routing, `--from-report`), and
`packages/viewer/src/app/components/Receive.tsx`
(`FieldReportView.fixtureCase`, the harvested-link/harvest-command branch)
all present and match this description.
