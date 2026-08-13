# Hand-off: eval skills + evals UI (2026-08-12)

Written for a model picking up this thread cold. Everything below is
either shipped code, a director ruling, or a clearly-marked open
question. Cite it as the handoff; the durable records are
`docs/proposals/2026-08-11-the-merge-skill-json.md` (data model),
`docs/proposals/2026-08-11-architecture-review-runner.md` (layers /
runner), `docs/research/2026-08-11-eval-ecosystem-survey.md`
(competitive landscape), and `docs/friction/e2e-readiness.md` (running
friction log + eval-writer founding notes).

## 1. Where the product is (as of main `1a745c1`)

**THE MERGE shipped 2026-08-11** (13 PRs) plus #230 this morning. The
skill bundle now has ONE structured record, `skill.json`
(schemaVersion 2), at the bundle root:

```jsonc
{
  "schemaVersion": 2,
  "skill":   { "slug", "name", "oneLiner", "tags", "created",
               "harnesses": ["claude-code"], "stage": "evaluating" },
  "design":  { "failureHypotheses": [
                 { "id": "OUT-3", "failure": "...", "probability?": "Medium",
                   "impact?": "Medium", "mustNever?": "...",
                   "cases": ["nothing-worth-writing"] }   // pointers only
             ]},
  "evals":   { "cases": [
                 { "name": "nothing-worth-writing",   // == evals/cases/<name>/
                   "class": "empty",                  // golden|refusal|empty|rerun|hard-case|trigger
                   "setup": "prose: the input state that exposes the risk",
                   "expectedBehavior": "prose: what passing looks like",
                   "expected": "expected.md", "checks": [],
                   "sandbox": { "files": "files/", "env": {} },
                   "source?": { "kind": "field-report", "eventId": "..." } }
               ],
               "configs": [ { "id", "provider", "model" } ] },  // auto-registered on first run
  "publish": { "targets": [ { "audience": "user" } ] }
}
```

Absorbed and deleted: `bundle.json`, root `evals.json`, per-case
`case.json`, `stations.json`, `evals/risk-map.md`. Directory rename:
`evals/fixtures/` → `evals/cases/`; `expected/answer-key.md` →
`expected.md`. All 6 repo bundles + 3 packaged copies migrated (#229).
The migration script (`scripts/migrate-skill-json.ts`) is explicitly
throwaway — 2–3 other owned repos still to migrate, then delete it and
its three root devDeps.

**Key model facts.**
- Hypothesis → case is the ONLY edge (`cases: []` pointers). Cases carry
  no `risks[]` back-reference. Proof specs were ABSORBED into cases
  (director ruling): a proof spec and a planned case are the same thing
  at different maturities.
- A case entry with NO `evals/cases/<name>/` directory is **planned**;
  with a directory it is **realized**. Coverage is DERIVED: hypothesis
  covered when all pointed cases are realized, partial when some, gap
  when none.
- Runs are immutable records in `runs/<id>/` (run.json, transcript.jsonl,
  response.md, artifacts/). Grades are git-visible FILES beside them:
  `runs/<id>/grades/<grader>/grade.json` (latest) + `grade.<n>.json`
  (history). Journal `run.graded` event still fires, for UI liveness
  only. `grader: "human"` today; `checks` and `judge` lanes are designed
  but unbuilt.
- Measurements: computed cells keyed (skill, case, versionHash, provider,
  model), NEVER pooled, Wilson / rule-of-three CIs. Unchanged by THE
  MERGE.
- Stage: declared in `skill.json.stage`; transitions write the file first,
  journal event second. There is NO declared-vs-live split (director:
  "how are they actually different?").
- Gates are LIVE (`packages/core/src/StageGates.ts`), ruled table:
  idea→researching HARD (name + oneLiner non-empty); researching→drafting
  HARD (design.md non-empty); drafting→evaluating HARD (output/SKILL.md
  exists); evaluating→published SOFT (warn "publishing unmeasured", never
  block — replaced a shipped HARD guard); archived ungated. `--override`
  and backward moves bypass.
- `packages/runner` is extracted with a standalone `sms-runner` bin
  behind an env-var contract (SMS_CASE_DIR, SMS_SKILL_DIR, SMS_PROVIDER,
  SMS_MODEL, SMS_RUN_DIR…; exit 0 completed / 1 task-failed / 2 usage /
  3 infra-error). Core keeps only dispatch + journal. Repo/npm extraction
  deferred until an external forcing function.

**CLI doors (the only sanctioned write path for agents):**
`skillmaker claims add <slug> --id --failure [--must-never --probability
--impact]` · `case plan <slug> --name --class [--setup --expected-behavior
--risks]` (planned case, no materials; idempotent; alias `fixture plan`) ·
`case add` / `fixture add` (realizes materials) · `case harvest` /
`fixture harvest` (from a `skill.field_report` event) · `run <slug>
--case --config` · `grade`. Legacy (pre-skill.json) bundles keep their
old behavior on every door.

**Test surface:** ~1185 unit + 372 e2e, plus a Playwright viewer suite
(`bun run test:playwright`, 9 tests, skip-guarded in CI) and a
golden-path e2e that walks birth → research → draft → case → run →
grade → measure → publish asserting the journal sequence.

**In flight right now:** a Sonnet subagent is cutting **v0.7.0** (minor
bump for the schema generation change) via the `skillmaker-dev-release`
skill; it was waiting on main-tip CI (now green) before the bump PR.
Open PRs: **#214** factory implement node terra-med→sol-medium (director
parked factory work for 2026-08-12/13) and **#222** (GTM, not this
thread's work).

## 2. The design conversation this hands off

Goal: the **eval-writer skill**, the evaluating-stage William. Founding
notes (director thinking aloud, 2026-08-08, in
`docs/friction/e2e-readiness.md`): fixture design is ITERATIVE with
human judgment — propose → "would this actually happen?" → refine;
HARVESTED over synthetic (point the model at real transcripts/logs);
fixtures carry provenance. Standing director rulings on it: build it
THROUGH the product with design-skill facilitating; it is NOT to be
agent-built without him; it must beat the **unguided baseline** (a bare
gpt-5.6-sol told only "author the evals" produced 23 banded risks and 10
proof-spec fixtures, voluntarily routing everything through CLI doors —
so the skill's value must be the human-judgment choreography, not
artifact generation).

### The pivot that reframed everything (director, this morning)

1. "We need to design the skill around the UI surface for visualization
   and review — otherwise the skill assumes things about the user's
   ability to see/review/edit that make the skill less effective."
2. "Even thinking in terms of 'where to start the loop' is actually a
   UI/UX question."
3. "We should craft skills around the different needs: create a new case
   that covers some risks · run a case with a specific config · make a
   change and compare it. And probably others. And probably all of these
   don't need skills. Maybe the first skill is just **'create a new case
   that covers some of the risks.'**"

So: **there is no monolithic "eval-writer."** There are several eval
NEEDS; each is a row-affordance on the evals surface; some deserve a
skill, most probably don't. The first (and possibly only) skill to build
is **create-a-case-covering-risks**.

### The state-table framing (agreed, not yet written)

Entry points are ROWS, not a skill-owned itinerary. Each tree state
invites a different conversation:

| Row state | Invitation | Likely needs a skill? |
|---|---|---|
| hypothesis with `cases: []` (gap) | realize this | **YES — the first skill** |
| planned case, no materials | make this real | YES (same skill) |
| hypothesis that never survived contact | challenge / cut / reframe | probably not — a chat turn |
| realized case, no graded runs | run + grade me | no — a button + `run`/`grade` |
| set feels thin (tree-level, not a row) | what's missing? | maybe later |
| a change landed, compare versions | run + diff measurements | no — UI + existing measurement cells |

Chat mirror of the same state (the "two doors, one journal" invariant):
when the user opens with "let's work on evals," the skill reads the same
tree state and speaks the same options back rather than proposing
anything unprompted.

### Three UI rulings proposed by Raven, NOT yet ruled by the director

1. **Proposals materialize immediately** as planned cases via `case plan`
   (visible in the tab through the existing SSE tick), so review happens
   on the surface, not in chat scrollback. Rejection deletes the entry.
2. **Verdict affordance = accept / reject / "wouldn't happen" buttons on
   the proposed-case row**, injecting a structured steering message into
   the running chat session (steering shipped in #191 — a button press is
   a pre-formed steer). Keeps the verdict inside the conversation the
   skill can respond to.
3. **Editing is chat-mediated** (say what's wrong → skill edits materials
   → fold refreshes). Inline editing in the tab is out of scope; the
   Persona-Map card records a persona hostile to eval depth ("Don't
   overwhelm me with this eval stuff"), which argues for a review
   surface, not an authoring surface.

### What the evals UI has today vs. needs

HAS: claims tree with derived coverage; fixture folds showing full
prompt/expected bodies inline (#216); read-only mode pre-draft
(`evalsRunnable` = draft AND ≥1 fixture); per-fixture live "running"
pulse; SSE refresh on journal ticks; chat panel beside center tabs;
chat-link → center-tab navigation.

NEEDS (for the loop above): a "proposed / awaiting verdict" visual state
distinct from ordinary planned cases; the verdict buttons wired to
steering; a coverage strip (n hypotheses realized / planned / gap); the
hypothesis → case lineage legible in the tree (the model now supports it
natively — the tree should be hypothesis → case → run lanes → grades).

## 3. Suggested next moves

1. Get the three UI rulings decided (director; Danvers is the natural
   second reader — he has not seen any of this yet and the framing is now
   clean enough for his first full look).
2. Write the **state table** as the joint artifact: for each row state —
   what it renders, what it invites, what happens when the invitation is
   taken, what state it transitions to. The skill's SKILL.md becomes the
   chat-side rendering of that table; the UI work list falls out of the
   same document.
3. Birth `create-a-case-covering-risks` (or whatever it ends up named)
   **through the product**, design-skill facilitating — dogfooding the
   loop the skill itself is about. Its evidence sources: the founding
   notes, skill #2's transcripts, and the director's own codex
   fixture-drafting session he flagged as "really interesting."
4. Keep the parked items visible: Eval-tab redesign (this thread),
   SQLite-backed detail handlers, the deterministic `checks` lane
   (`{checker, ...}` objects — `checks` is `string[]` today), per-risk
   grading (maps onto Braintrust multi-scorer; parked), drift-scoped eval
   selection (upskill's git-diff trick), migrating the other owned repos
   then deleting the migrate script.

## 4. Working conventions for whoever picks this up

- Agents work in isolated worktrees; never branch in the primary
  checkout. PRs merge on green; the director reviews shapes and data
  (he read `skill.json` itself, not the code), not diffs.
- `bun test` prints its pass/fail summary ABOVE the "Ran N tests" line —
  grep `^ [0-9]+ (pass|fail)`, never tail. CI typechecks
  `packages/core` and `packages/cli` separately; nothing under
  `packages/*` may import `scripts/`.
- Credentials are never handled by an agent (npm OTP, gh auth, railway,
  daytona — the director does those in his terminal).
- Local codex sessions can scaffold but cannot verify: their sandbox
  blocks localhost binding, git metadata writes, and `gh` auth. Pattern
  that works: codex scaffolds → a Claude agent verifies, fixes, and
  ships. Also: `codex exec` hangs if stdin is left open.
- Other repos' skill bundles are user data — never modified.
