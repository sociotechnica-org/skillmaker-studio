# The Skill Is the Product: Four Connected Rulings

*Proposal — Jess, 2026-07-20. For the Danvers × Jess reconciliation, alongside
[`2026-07-17-data-model-draft.md`](2026-07-17-data-model-draft.md). Written after
a first hands-on session with the week's build.*

## The Thesis

The core of this product is working on **a single skill**. Everything else — the
board, the lab, the dock, the marketplace — is either a view of skills or an
action on a skill. The current build inverts this: five motion tabs at the top,
each a room the skill visits, with the skill itself having no home page until
the card work began sneaking one in.

The data-model draft's own principles argue for the inversion's fix:

- **P2**: "stores are one; views are many... a rename is a label diff" — so this
  restructure is a re-projection, not a schema change.
- **The practical test**: "for any screen, name which noun each element
  renders." The Make board renders *stage-of-skill*, the Lab renders
  *proof-of-skill*, the card renders *skill* — three screens, one noun. That's
  the signature of a primary object missing its page.
- **#118 ("Card belongs to every room")** is the tell: when one object needs a
  passport for five rooms, the object should be the home and the rooms should be
  views.

Four rulings follow. They stand or fall together.

## Ruling 1 — Navigation: Board above, Skill below, Dock beside

Retire the five motion tabs as top-level navigation. The evidence from use: the
Make tab opens onto a second pipeline (Frame → Research → Draft → Proof →
Publish), so a skill's "where" is two-dimensional; and the Publish column has to
say "1 in the Lab →" — one phase system pointing into another tab's phase system
to tell the truth.

Proposed shape:

- **Board** — the top level. All skills, the higher-level portfolio view.
  Absorbs Track: the catalog is the board's list, the feed and archive are its
  drawers.
- **The Skill page** — the primary object, reached from the board. Essentially
  the card, grown up: design, evidence, runs, ship history, drift, lineage as
  tabs or sections. Make/Improve/Ship stop being places and become *actions and
  state here*: stage is a field on the skill, "Ship" is a button with receipts,
  the bench is the skill's evidence tab under pressure.
- **Dock** — a workspace-level inbox (badge + queue), beside the board, not a
  peer phase. This is the one surface that genuinely can't be skill-scoped: a
  crate is *pre-skill* — the whole mechanism exists to defer "which skill is
  this?" to a human. It's the membrane in front of the catalog, not a stage of
  it.
- **Marketplace / bundles of skills** — layers above the board, later.

## Ruling 2 — Vocabulary: plain English on every user-facing surface

The house metaphor system is internally coherent and that is exactly what makes
it a private language: every term is meaningful once you've read the doc that
defines it, and there are forty docs. The second-most-informed person on this
project had to ask what a crate is.

The rule: **user-facing words are plain English; metaphors may live in design
docs only.** The mapping is mostly one-to-one, which shows the metaphors aren't
earning their keep:

| House term | Plain term |
| --- | --- |
| Skill Bundle | skill |
| Crate | incoming skill (unreviewed) |
| Receiving Dock | import queue |
| The five doors / dispositions | import decisions |
| Lab / Bench / Queue | eval workspace |
| Proof | evals |
| Field report | session log / feedback from the wild |
| Harvest | turn a report into a test case |
| Journal | event log |
| The Feed | activity |
| Motions | (retired with Ruling 1) |

Keep the handful of coinages that carry a distinction plain words would blur —
**Unverified** (received, never measured *by us*), **salvage** (refusal with a
record, value extracted), **fork** — and define them in one glossary.

This is the cheap kind of change by the draft's own law (display renames never
touch stored values), the display-layer rename pattern already exists (#62,
#69, #74), and Danvers queued the door himself: the schema-migration brief's
name-convergence map, and the closed #102 ("one owner per word").

## Ruling 3 — Proof and Improve are one thing

"Make writes the proof; the Lab runs it" draws a boundary between authoring
fixtures and running them. Nobody works that way: the real loop is write a
fixture → run → grade → see the gap → write the next fixture, minutes around.
P4 calls this "the claim loop" and stresses it is *closed*; the Proof/Improve
split cuts it in half and puts the halves in different tabs.

The model already can't keep them apart:

- The bench lights up "the moment fixtures exist and measurements are thin" —
  which is precisely the state of every skill in the Proof column. A skill at
  Proof is *always* also on the bench. Two rooms, same skill, same work.
- The bench is explicitly column-orthogonal ("improvement never checks your
  column"), so Proof-as-a-stage carries no information the bench signals don't
  already have.
- `deriveEntryStage` routes runnable arrivals "to Proof," which really means
  "needs measuring" — i.e., straight onto the bench, where they were going
  anyway.

Proposed shape: the drafting ladder ends at **Draft**. After that a skill is in
the **continuous evidence loop** — author, run, grade, measure, repeat — with
bench signals saying how urgently it needs hands and the publish gate as the one
hard exit. Proof stops being a place you pass through and becomes what it is: a
level of confidence the skill has earned so far.

What survives the merge, deliberately: the *data* distinction between authored
coverage (the risk map — what you claim to have thought about) and measured
validation (what runs say). Those never merge as facts; they are two axes on
one surface, not two rooms.

Honest cost: stage is a stored ladder (`bundle.stage_changed`), so unlike
Rulings 1–2 this is not purely a label diff. The stored-vocabulary freeze
pattern handles it: old events stand, display remaps (`proof` renders as
in-the-loop). This retires a recent ruling (Make's four columns) and belongs in
the reconciliation, not in a quiet PR.

## Ruling 4 — Run findings become work

Live finding, 2026-07-20: an eval run on `william-draft-skill-md`
(`hard-case-conflicting-sections`) surfaced a design conflict, and the read-out
offered exactly one affordance — grade the agent. Two different judgments about
two different objects were collapsed into one form:

- *Did the agent behave well given what it was handed?* — the grade; feeds
  measurements. (In that run: yes, exemplary.)
- *What did this run reveal, and who's on the hook for it?* — a finding that
  needs a human ruling. **No affordance.** The banner lives in a sandbox
  artifact nobody will reread; the finding evaporates the moment the grade
  lands.

The model already has the pattern and didn't wire it to runs. "Signal becomes
work" (#86): field reports mint todos (`origin: {kind: "field-report"}`);
intake testimony mints todos (`origin: {kind: "intake"}`). Runs are the third
signal source — arguably the richest — and the only one with no door into the
queue. `TodoOrigin` is already a per-kind union (#106); the shape is asking for
it.

Proposed:

- Add `origin: {kind: "run", runId}` and a second affordance on the read-out:
  *"this run surfaced work → open a todo,"* origin-stamped so the queue item
  links back to the transcript as evidence.
- Keep verdict and disposition orthogonal. A run can be a pass that demands
  follow-up or a fail that demands nothing (known gap, already queued). The
  reserved-words ledger's own preaching — "three judgments, never merged" —
  applied to the grading panel.

## Appendix — Small Faults Noticed in the Same Session

Neither blocks the rulings; both are cheap.

1. **Sandbox artifacts wear the real file's name.** The run read-out labels a
   sandbox artifact `output/SKILL.md` — the exact path of the bundle's real
   distributable — with nothing marking it as sandboxed eval output. First read
   was "the eval wrote into my skill file." In a product whose thesis is
   provenance, that label lies about provenance. Badge it "sandbox" or show the
   `artifacts/` path.
2. **A fixture's skill leaks into the catalog.** `skillmaker list` shows
   `changelog-entry-writer`, which exists only as
   `william-research-a-skill/evals/fixtures/golden-basic/files/bundle.json` — a
   fixture's prop, indexed as if it were a catalog skill (0 events). If #118's
   "first-class fixtures" intends this, the display should say so; if not, the
   scanner should skip fixture subtrees.
3. **Marketplace publish is destructive and unjournaled.** A viewer publish
   action (2026-07-20, ~17:15) rewrote the repo-root `README.md` with generated
   marketplace content (clobbering the real README) and *appended a duplicate*
   `william-draft-skill-md` entry to `.claude-plugin/marketplace.json` instead
   of reconciling the existing pre-#114-shape entry — while appending **no
   journal event** (idempotency on the version hash suppressed it, but the
   file writes happened anyway). Three faults in one act: generated output
   colliding with a hand-written source file; regeneration that appends rather
   than updates; and a state change the journal never saw. The receipts-in-
   manifest design itself is sound — the write path isn't.
