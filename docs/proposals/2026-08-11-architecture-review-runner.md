# Architecture review — layers, the runner contract, and the Inspect swap

2026-08-11 · drafted by Raven; v2 — director's rulings folded in
(2026-08-11); remaining open: per-risk grading (parked), drift-scoped
selection (parked). Companion:
`2026-08-11-the-merge-skill-json.md` (read that first — this doc assumes
the merged `skill.json`). Research basis:
`docs/research/2026-08-11-eval-ecosystem-survey.md`.

The frame (ruled): Rails shipped sqlite in the box and ActiveRecord
owned the schema, so Postgres later was a dialect swap. SMS's ACP
RunEngine is the bundled sqlite; `skill.json` is the ActiveRecord; this
doc draws the adapter seams that make external execution (Inspect, or a
customer's own infra) a dialect.

---

## 1. The layers

```
┌─────────────────────────────────────────────────────────────┐
│  SURFACES        viewer (Board/Skill page/Eval tab/Chat)    │
│                  CLI (skillmaker …)                         │
│                  — two doors, same operations               │
├─────────────────────────────────────────────────────────────┤
│  API / SESSIONS  project-scoped HTTP + SSE ticks            │
│                  ACP chat sessions (William/design-skill)   │
├─────────────────────────────────────────────────────────────┤
│  LIFECYCLE CORE  workspace svc · stage machine              │
│                  publish door · version records · journal   │
│                  index (SQLite, derived) · measurements view│
├─────────────────────────────────────────────────────────────┤
│  THE SCHEMA      skill.json  +  case materials  +  runs/    │
│  (ActiveRecord)  — the only truth the layers above share    │
├─────────────────────────────────────────────────────────────┤
│  EXECUTION       runner contract (env-var, standalone exec) │
│  (adapters)      ┌──────────────┬──────────┬─────────────┐  │
│                  │ bundled ACP  │ Inspect  │  (future:   │  │
│                  │ RunEngine    │ adapter  │  HF Jobs,   │  │
│                  │ ("sqlite")   │          │  smevals…)  │  │
│                  └──────────────┴──────────┴─────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  GRADING         grader lanes over immutable runs:          │
│  (adapters too)  deterministic checks · LLM judge · human   │
└─────────────────────────────────────────────────────────────┘
```

Two rules give the diagram its force:

- **Everything above the schema line reads/writes `skill.json` + `runs/`
  and nothing below it.** The viewer never knows which engine ran a
  case; the engine never knows a viewer exists.
- **Everything below the schema line is replaceable per-run.** Runner
  and graders are chosen at dispatch time; their outputs land in the
  same shapes regardless of which one ran.

## 2. The runner contract

A runner is a **standalone executable**. Invariant (the acid test): the
bundled runner builds and runs with no imports from lifecycle core — if
Studio disappeared, it would still run a case.

**In** (env vars, smevals-shaped so both directions of interop stay
open):

```
SMS_CASE_DIR      …/evals/cases/nothing-worth-writing/
SMS_CASE_NAME     nothing-worth-writing
SMS_SKILL_DIR     …/output/            (the version under test, resolved)
SMS_VERSION_HASH  sha256:…
SMS_PROVIDER      claude-code          (the config's harness; configs are
SMS_MODEL         claude-sonnet-5       auto-registered by the door on first
                                        run against a new (harness, model)
                                        pair — ruled, MERGE R5)
SMS_RUN_DIR       …/runs/<id>/         (empty dir, runner fills it)
SMS_TIMEOUT       600
```

The runner materializes `SMS_CASE_DIR/files/` into a sandbox, installs
`SMS_SKILL_DIR`, drives one session with the case's `prompt.md`, and
writes:

```
runs/<id>/
├── run.json          # the shipped shape, unchanged (see MERGE §1e)
├── transcript.jsonl
├── response.md
└── artifacts/        # workspace diff
```

**Exit codes** (shipped semantics, now contract): 0 completed ·
1 task-failed · 2 usage · 3 infra-error. Failed-run ≠ failing-run:
infra-error runs are kept, never graded, never measured.

**What stays OUT of the contract:** grading (separate layer), journal
events (lifecycle core appends `run.started`/`run.completed` around the
runner invocation — the runner doesn't know the journal exists),
measurement math (a view over run.json files).

**Packaging:** `packages/runner` in the monorepo, depending on contract
types only. Repo/npm extraction deferred until an external forcing
function (CI-without-Studio, customer-perimeter execution). Boundary
now, split later — the ActiveRecord precedent.

## 3. Grading lanes

**RULED (2026-08-11), no longer proposed:** git-visible grade files are
required — the grade file is the record; grades cannot be journal-only.
Grades are records **about** runs, appended beside them:

```
runs/<id>/grades/<grader>/grade.json
```

- `grader: "checks"` — deterministic: lifecycle core (or the runner
  post-step) executes the case's `checks[]` (contains / file_exists /
  file_contains / command — upskill's verifier set, smevals' checker
  contract: exit 0 = pass, optional stdout JSON).
- `grader: "human"` — the shipped grading panel/CLI verdict
  (pass/fail/partial + per-check boxes + notes). Journal `run.graded`
  event still fires for UI liveness; the grade file is the record.
- `grader: "judge"` — future LLM lane, same shape.

Regrades append (new grade.json versions or event history — latest
wins at read, exactly the shipped `gradeByRunId` fold). Multiple lanes
coexist on one run without touching it. This is smevals' re-gradability
model unified with our append-only human grades.

Measurements are unchanged: computed cells over graded runs keyed
(skill, case, versionHash, harness, model) — the config axis, per the
MERGE R5 ruling — never pooled, Wilson / rule-of-three CIs. A future
per-risk refinement (checks tagged with hypothesis ids → per-risk
cells) slots into the checks lane without schema surgery — parked, per
ruling.

## 4. Worked example: swapping RunEngine → Inspect

Inspect (UK AISI) is the one external engine with our shape: Docker/K8s
sandboxes, fixture materialization, and an agent bridge that runs
Claude Code / Codex CLI as the solver (survey §landscape). The swap is
an **adapter executable**, `sms-runner-inspect`, conforming to §2:

1. **Translate in.** Read `SMS_CASE_DIR` + env: emit an Inspect task —
   sample `input` = `prompt.md`, sandbox files = `files/`, solver =
   Inspect's Claude Code bridge pointed at `SMS_SKILL_DIR`, model =
   `SMS_MODEL`. (Mechanical: our case maps onto task/sample 1:1; the
   survey's term table is the translation dictionary.)
2. **Run.** `inspect eval` in the adapter's process; Inspect owns
   sandboxing, retries, parallelism (`-n` fan-out becomes epochs).
3. **Translate out.** Parse Inspect's eval log → write our `run.json`
   (status from Inspect's error taxonomy mapped onto
   completed/failed/infra-error), transcript from its message log,
   artifacts from the sandbox diff. Exit with the mapped code.

What the layers above see: nothing. Same run dir, same grading lanes,
same measurement cells — `runner: "inspect"` in machine settings (MERGE
Part 3) or per-dispatch flag is the only visible difference.

What we give up when running on Inspect: run-dir writes mid-flight (our
engine streams; Inspect delivers at the end — the per-fixture Running
pulse degrades to started/finished), and our exact sandbox semantics
(theirs is Docker-shaped, ours is temp-dir-shaped — `setup.env`
translation needs care). What we gain: epochs/parallel fan-out, K8s
scale-out, and the enterprise line item — "run your eval suite on your
own infra" — that the lifecycle pitch wants.

The same recipe writes the other adapters: HF Jobs (upskill's one
operationally interesting bit) for cheap parallel fan-out; smevals
itself if it matures (our env contract is deliberately close to
theirs); Braintrust post-launch as a *mirror*, not a runner — an
exporter walking `skill.json` cases → dataset NDJSON and graded runs →
experiment logs.

## 5. What this unlocks, in order

1. **The eval-writer skill** (the actual goal): it choreographs
   propose → "would this actually happen?" → refine, writing through
   CLI doors (`case add`, `claims add`, `run -n`, `grade`) against one
   coherent schema instead of four files.
2. **Runs UI** (Runs view, Active-Runs strip): one `runs/` shape with
   live status makes those surfaces cheap.
3. **Enterprise story**: lifecycle in `skill.json` (portable, git-
   native, platform-death-proof — see OpenAI Evals shutdown), execution
   wherever the customer wants it.

Open items deliberately NOT in this doc: per-risk grading (parked),
drift-scoped eval selection (upskill's git-diff trick — post-migration),
Braintrust exporter (post-launch), repo extraction of the runner
(needs forcing function).
