# Schema-Migration Brief — for Jess
### Optional projects, ready when you are · 2026-07-17

Companion to [`2026-07-17-data-model-draft.md`](2026-07-17-data-model-draft.md)
(the squared conceptual model, pending our joint review). This brief collects
the four structural projects the reconciliation deliberately did **not**
undertake — each is scoped, none is launch-blocking, and each is yours to
run, re-plan, or decline. Full decision-by-decision reasoning (with the
alternatives considered) lives in the decision docket in the malabo
workspace's `.context/`.

**The consolidated review diff** — everything since your last commit, as one
view: <https://github.com/sociotechnica-org/skillmaker-studio/compare/00532a98db7f5f503c5e8018d40e3764349fead6...main>

**Two standing rules any of these projects must respect:**
1. **The freeze.** Journal event type names, stage literals, and every
   stored enum value are frozen vocabulary. Display renames never touch
   them; growth is additive only.
2. **The lockstep test** (`packages/core/test/VocabLockstep.test.ts`, PR
   #104) asserts the hand-mirrored enums/labels equal across
   core/cli/viewer. Any migration keeps it green — and inherits it as the
   checker of whatever mechanism replaces hand-mirroring.

---

## 1 · Versioned vocabulary (the escape hatch we chose not to build)

**What:** a mechanism for renaming *stored* vocabulary if a frozen word ever
becomes actively harmful: `schemaVersion: 2` on new events + a fold-time
translation table (old value → new) so old journals read forever and new
writes use the new word.

**Current stance:** unbuilt on purpose. No stored value is on anyone's
regret list — the census found every collision at the label/identifier
layer, none in the journal. The plain freeze costs nothing; this mechanism
costs a translation layer in every fold, forever.

**When it earns a build:** the first time a stored word is discovered to be
*misleading in a way that causes real mistakes* (not merely inelegant).
Sketch: one `TRANSLATIONS: Record<eventType, Record<old, new>>` applied at
the single journal-decode chokepoint; a test asserting v1 fixtures fold
identically. Small — the discipline is the hard part, and the freeze
already supplies it.

## 2 · The name-convergence map (and the staged big-bang option)

The display layer went through three rename waves; the reconciliation then
*restored* two old names to their original jobs, which shrank this project
substantially. The full map:

**Already correct — do not touch (restored by ruling):**
- `/api/catalog`, `CatalogEntry`, `CatalogResponse`, `useCatalog` — serve
  the **Catalog** (Track's registry room; "this exists," inside-complete).
- `/api/skillbook`, `Skillbook.ts`, `useSkillbook` — build the **Skillbook**
  (the outward curated book; "shipped, with receipts," published from Ship).
- All journal vocabulary and stage literals (frozen).

**In flight (PR C, the vocabulary tidy):** todo `archived`→`swept`
identifiers; `SkillLifecycle` values → `deprecated | in-progress`;
`listUndisposedIntake`→`listUndisposedCrates`; `STAGE_LABEL` `Evaluate`→
`Proof`; nav labels Board→**Make**, Lab→**Improve**.

**Pending the surface era (PR E — Track/Catalog/Archive/card):** the
**Track** tab (Catalog + Feed merge — today's Ship page content is mostly
Catalog material and largely relocates there); the Archive drawer;
retirement of the Published column + `ARCHIVED_LABEL` from Make; `Board.tsx`
→ `Make.tsx`, `ActivityFeed.tsx` → `Feed.tsx`; route ids `board|lab|activity`
→ `make|improve|track` (old URLs kept as aliases — the router's existing
pattern); the Lab bench fed by a pressure-filtered view instead of the full
catalog.

**The staged big-bang (your option):** once PR E stabilizes, the remaining
internal names can converge in one or more mechanical PRs — suggested
stages: (1) component/file names, (2) route ids with aliases, (3) hooks and
type names. Each stage is behavior-free and lockstep-guarded. The
alternative (opportunistic convergence as files get touched) is the standing
policy if you'd rather not spend the review.

## 3 · Mirror consolidation

**What:** ~a dozen enums/labels are hand-mirrored between core and the
viewer because the viewer deliberately never imports core (the wire is its
contract, and its tolerant fields — e.g. fixture `class` as open string —
earn their keep). The lockstep test makes drift loud; this project makes it
impossible: either a `shared-vocab` package both sides import, or codegen
from core's definitions into `schemas.ts`.

**Trigger:** the mirror count grows, or a third consumer appears. Until
then the test is cheaper than the machinery. If you build it, the lockstep
test survives as the checker of the generator.

## 4 · The authority layer (flagged as a known gap — build-sooner is on offer)

**Current state:** deliberately thin. The review pair terminates every agent
action at a human decision; the publish gate is the one hard gate; `override`
is the director's standing self-grant, journaled. There is no ceiling and no
grant — any actor with workspace access can do anything.

**The shape is pre-ruled** (so a build doesn't re-litigate design): grants
are journal events (`grant.issued` / `grant.revoked` — director, scope,
revocable, append-only history of trust); enforcement is append-time guards,
exactly like stage-transition guards; checks are folds. No policy engine, no
new store. Likely first scoped surface: gate decisions, crate routing, and
station launches.

**Tripwires that make it urgent** (any one): a second director shares a
workspace · outside-made skills do station labor under our roof · any
automation fires unattended (an unattended fire needs a standing grant to
fire under — which is also why the trigger registry and this layer gate each
other and arrive together).

**Status:** the director's explicit position is that this is a real known
problem, an offered project rather than a launch requirement — sooner is
welcome if you want it.
