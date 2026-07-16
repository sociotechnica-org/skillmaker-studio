---
type: Entity
prefLabel: Shipment
context: outputs
status: new
links:
  related_to:
    - "../_index/Vision - Board Lab Ship Receive"
    - "./Entity - Skill Version"
    - "./Mechanism - Drift Hint"
    - "./Mechanism - Publish"
    - "./Entity - Skillbook"
    - "./Entity - Field Report"
---

## WHAT

A record that a specific recorded version of a bundle left for a
destination and purpose, carrying its measurement receipts *frozen at
that moment*: `skill.shipped` — `{bundle, versionHash, destination,
purpose, receipts}`, where `receipts` is
`[{fixtureCase, provider, model, n, passes, passRate, ci}]`, the
`computeMeasurements` snapshot for that version at ship time. It is the
outbound half of the checkout/return-record primitive the Board · Lab ·
Ship · Receive model names but does not yet fully build (`Vision - Board
Lab Ship Receive.md` §HOW) — the bill of lading a skill leaves with. Unlike
`skill.published` (`Mechanism - Publish`), a shipment carries no
idempotency key: re-shipping the same version to the same destination is
a real, distinct event, not a duplicate to collapse — a skill can leave
for the same place twice, for two different reasons, and both trips
belong in the record.

## WHY

Before this, the only thing that ever left the studio was a static
`skillmaker book build` site — "published" was the terminus, and there
was no record that *version X of skill Y went to destination Z, for
purpose P, with these guarantees* (issue #66). That gap matters because
independence changes what "leaving" means: skills built here now go to
other agents, repos, and runtimes, where they change and generate field
signal the studio never sees unless something recorded what shipped and
in what state. A shipment is that anchor point — not a delivery
mechanism (it copies nothing, unlike `Mechanism - Publish`'s
`git-dir`/marketplace targets), just the fact of departure with its
guarantees attached.

The receipts are a *snapshot*, not a live join, on purpose. Measurements
are computed-at-read and move as new runs land for the same version
(`Measurements.ts`'s whole model is "never stored, always recomputed") —
so without freezing the numbers at ship time, "what did this skill ship
as" would silently drift into "what does it measure as today," and the
manifest would lie about what the recipient actually received. This is
also why shipping is deliberately **not** a board-state effect: it isn't
a stage change like `bundle.stage_changed`, so `Fold.ts`'s
`foldBundleStates` never branches on `skill.shipped` — a skill can ship
from any stage without disturbing where it sits on the Board or in the
Lab.

## HOW

`shipBundle` (`packages/core/src/Ship.ts`) resolves which version to
ship — the latest recorded one by default, or the version matching
`--version <hash-prefix>` — and fails with `ShipNoVersionError` if the
bundle has never had a version recorded at all (nothing to ship). It then
computes live drift against the shipped version (`computeDrift`, see
`Mechanism - Drift Hint`) and surfaces it as a warning, never a block —
same house rule as everywhere else drift appears: "displayed, never
enforced." Receipts come from a scratch `IndexService.listMeasurements`
call filtered to the shipped `versionHash`, mirroring how
`Publish.ts`'s `gatherMeasurements` gathers receipts for the
marketplace README. Finally it appends `skill.shipped` with no
`idempotencyKey`.

CLI: `skillmaker ship <slug> --to <destination> --purpose <text>
[--version <hash-prefix>] [--json]` (`packages/cli/src/commands/Ship.ts`).
Journal: `bundleForEvent` (`Fold.ts`) indexes the event to its bundle for
the `events` mirror and Activity feed, same as every other bundle-scoped
event — no new SQLite table, the generic mirror is enough to list
shipments per bundle.

Viewer: Ship's per-bundle chapter (`SkillbookBundlePage`, `Ship.tsx`)
renders a **Shipments** section — destination · purpose · version · when
· receipt count — built from `SkillbookBundle.shipments`
(`packages/cli/src/Skillbook.ts`), which folds every `skill.shipped`
event for the bundle from the same journal read `buildSkillbook` already
does. Ship's index rows gain a one-line summary ("Shipped Nx — last
to `<destination>`") when shipments exist. The viewer does not import
`@skillmaker/core`, so this shape is hand-mirrored in
`packages/viewer/src/app/runtime/schemas.ts` (`ShipReceipt`,
`SkillbookShipment`) — kept in lockstep by hand, not by a shared type.

Deliberately not built yet (`Vision - Board Lab Ship Receive.md` §HOW
sequencing, issue #66's own scope line): no viewer ship button -- this
half is CLI-first, the viewer only reads. The inbound channel this card's
"not built yet" originally named -- the `field-report` half of the
checkout/return pair -- shipped in #67 (`Entity - Field Report.md`);
`skill.field_report` carries an optional `versionHash` back to the
specific `skill.shipped` this card describes, when the reporter knows it.

Verified: `packages/core/src/Journal.ts` (`SkillShippedEvent`,
`ShipReceipt`), `packages/core/src/Ship.ts` (`shipBundle`,
`ShipNoVersionError`/`ShipVersionNotFoundError` in `Errors.ts`),
`packages/core/src/Fold.ts` (`bundleForEvent`'s `"skill.shipped"` case,
`foldBundleStates` untouched), `packages/cli/src/commands/Ship.ts`,
`packages/cli/src/Skillbook.ts` (`SkillbookShipment`,
`SkillbookBundle.shipments`), and `packages/viewer/src/app/components/Ship.tsx`
all present and match this description.
