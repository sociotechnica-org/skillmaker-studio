# Skillmaker Studio — Data Model

> **Status:** v2 discussion draft (2026-07-10). Part 1 records the model and
> the director's rulings; Part 2 is the concrete form — every file, every
> schema, every journal event. Part 2 is the part under active discussion.
>
> **Grounding:** derived from a full study of the predecessor studio. Inherited laws cited as **[inherited]**.

## Part 1 — The model

### 1.0 The one-sentence model

A **Skill Bundle** is the durable asset — research, design thinking, eval
fixtures, runs, and status — and **SKILL.md is one of its outputs**: a
distributable projection that the bundle produces, tracks, and measures, but
is not reducible to.

### 1.1 Inherited laws

1. **One source of truth per fact.** [inherited: registry-vs-board split]
2. **Artifacts have classes: source / output / record.** Sources are
   authored, outputs are produced (and may be hand-finished), records are
   immutable evidence. The class determines who writes it and whether it may
   drift. [inherited: brief→renderings architecture]
3. **Todo status and bundle stage are independent axes.** [inherited]
4. **Coverage and validation never merge.** Authored "a fixture exists" vs
   measured "it passes at rate r over n runs" are separate facts. [inherited]
5. **A single run is a sample, not a measurement** — n · pass-rate · CI,
   never pooled. [inherited]
6. **Measurements bind to a version** (content hash) × provider × model.
7. **Provenance (Actor) on every mutating record.** [inherited]
8. **Failures are the curriculum** — run records are never cleaned up.
   [inherited]

Deliberately dropped (Fabro/Alexandria-era, ruled 2026-07-10): move graph +
derived renderings, Protocol A–E parity, E1–E16 resync cone, org spine
(Company/Division/Function), face agents, review levels. A "Fabro workflow"
may return later as an additional *output kind* — the output/ design below
keeps that door open.

### 1.2 Director rulings (2026-07-10)

- **A. Canonical store:** files + journal canonical; SQLite is a
  rebuildable index. **Ruled.**
- **B. Taxonomy:** flat `tags[]`. **Ruled.**
- **C. Gates:** one publish gate. **Ruled.**
- **D. Outputs:** one SKILL.md per bundle, measured across providers;
  extend later to **per-model** (not per-provider) variants. **Ruled.**
  (Measurements are already keyed by provider + model, so variants slot in
  without a schema change.)
- **E. Grading:** human-in-viewer from day one — the graded read-out
  experience is core magic to port. **Ruled.**
- **F. Stage ladder:** `idea → researching → drafting → evaluating →
  published`. **Ruled.**

### 1.3 The canonical-store consequence

Ruling A forces a clean three-way split. Every fact has exactly one
canonical home:

| Home | What lives there | Mutability |
|---|---|---|
| **Files** (`skills/<slug>/`) | Content: research, design, fixtures, outputs, run transcripts + artifacts, run metadata | Sources editable; outputs produced; records append-only |
| **Journal** (`events.jsonl`) | State + decisions: stage changes, gate decisions, todos, grades, versions, publications | Append-only |
| **SQLite** (`studio.db`) | Nothing canonical — materialized views + search index | Rebuilt by `skillmaker reindex` |

There is **no mutable state JSON** (no `board-state.json` descendant). The
board *is* a journal replay. Todos are journal-native entities. This is the
"could be event-driven" answer: state-y things are events; content-y things
are files; the DB makes both queryable.

## Part 2 — Concrete form

### 2.1 Workspace layout

```
<workspace>/
  skillmaker.config.json          # app config — tracked
  skills/
    <slug>/                       # one Skill Bundle — tracked
      bundle.json                 #   identity (append-slowly)
      stations.json               #   per-state work config, copied from template (§2.13)
      design.md                   #   source: the workflow thinking
      research/                   #   source: free-form markdown
        *.md
      evals/
        risk-map.md               #   source: authored coverage axis
        fixtures/
          <case>/
            case.json             #   source: the task + classification
            files/…               #   source: workspace inputs for the run
            expected/
              answer-key.md       #   source: grading key (never shown to agent)
      output/
        SKILL.md                  #   output: the distributable skill
        …                         #   output: bundled resources (scripts, refs)
      runs/
        <run-id>/                 #   record: immutable once ended
          run.json                #     execution metadata
          transcript.jsonl        #     ACP session log
          artifacts/…             #     files the agent produced (workspace diff)
  .skillmaker/                    # runtime dir
    events.jsonl                  #   the journal — TRACKED (merge=union)
    studio.db                     #   SQLite index — untracked
    local.json                    #   per-machine overrides — untracked
    claims/…                      #   server claim files — untracked
```

`.gitattributes` gets `.skillmaker/events.jsonl merge=union`; `.gitignore`
gets `.skillmaker/*` **except** `events.jsonl`. [inherited mechanics:
Alexandria ledger + `.ax-runtime` split]

> **New decision needed (G):** are `runs/` tracked in git? Law §1.8 says
> keep failures; transcripts can get big. Proposal: tracked by default
> (they're text, they compress, they're the curriculum), with a per-workspace
> config escape hatch (`"trackRuns": false` → `runs/` ignored, metadata +
> grades still survive in the journal).

### 2.2 `skillmaker.config.json`

```jsonc
{
  "schemaVersion": 1,
  "name": "my-skills",
  "skillsDir": "skills",
  "viewer": { "port": 4323 },
  "trackRuns": true,
  "providers": {
    "claude-code": { "command": ["npx", "-y", "@zed-industries/claude-code-acp@latest"] },
    "codex":       { "command": ["npx", "-y", "@agentclientprotocol/codex-acp@latest"] }
  },
  "publishTargets": [
    { "id": "dist", "kind": "git-dir", "path": "dist/skills" }
  ]
}
```

Per-machine overrides (provider paths, auth-adjacent bits) in
`.skillmaker/local.json`, deep-merged over the tracked config.

### 2.3 `bundle.json` — identity only

```jsonc
{
  "schemaVersion": 1,
  "slug": "frame-the-problem",          // = directory name; kebab-case; immutable
  "name": "Frame the Problem",
  "oneLiner": "Turn a fuzzy founder worry into a testable problem statement.",
  "tags": ["product", "discovery"],
  "created": "2026-07-10",
  "targets": ["claude-code", "codex"]   // advisory: which agents it's written for
}
```

Nothing mutable-in-anger lives here — no stage, no ready, no status.
Renames touch `name`; the slug is forever (it keys the journal).

### 2.4 `design.md` — the source of the skill's logic

Markdown with a light frontmatter and a *recommended* (not enforced)
section skeleton — the brief's descendant, minus the move grammar:

```markdown
---
bundle: frame-the-problem
---
# Design — Frame the Problem

## Intent
What outcome this skill produces and for whom.

## When to use / triggers
The situations that should activate it (this seeds SKILL.md's description).

## The workflow
The step-by-step logic, in prose. Numbered steps, decision points,
what the agent must never do.

## Failure hypotheses
| # | How it could fail | Risk family |
|---|---|---|
| 1 | Invents facts when input is thin | RE |

## Proof spec
Which fixture cases the failure hypotheses demand (seeds evals/).
```

The studio's "draft SKILL.md from design" generation reads this file; the
drift hint (§2.7) hashes it.

### 2.5 Fixtures — `evals/fixtures/<case>/`

`case.json`:

```jsonc
{
  "schemaVersion": 1,
  "case": "refusal-thin-input",          // = directory name
  "class": "refusal",                    // golden | refusal | empty | rerun | hard-case  [inherited kit]
  "risks": ["RE-1", "IN-2"],             // risk-map ids this case buys coverage for
  "prompt": "You have the frame-the-problem skill. The founder said only: 'growth feels off.' Produce a problem frame.",
  "setup": {                             // optional
    "files": "files/",                   //   copied into the run workspace
    "env": {}                            //   env vars for the agent process
  },
  "grading": {                           // optional hints for the human grader
    "answerKey": "expected/answer-key.md",
    "checks": [                          //   rendered as a checklist in the read-out UI
      "Declines to fabricate metrics",
      "Asks for the missing input instead of guessing"
    ]
  }
}
```

Rules carried forward: the answer key is grading-only, never enters the
agent's workspace [inherited]; adversarial fixtures may plant untrusted-input
attacks in `files/` [inherited: untrusted-input rule].

### 2.6 `evals/risk-map.md` — coverage axis only

```markdown
---
bundle: frame-the-problem
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | Empty/thin input | ● covered | refusal-thin-input |
| RE-1 | Invents metrics | ◐ partial | golden |
| ADV-1 | Prompt injection via pasted doc | ○ gap | — |
```

Risk ids band into the five inherited families (IN/RE/OUT/ADV/CHN);
machine-checked at reindex. **No results column** — validation is computed
from graded runs and joined in the viewer (law §1.4). Version bumps reset
displayed validation to "not yet measured" by construction (law §1.6).

### 2.7 Outputs and versions

`output/SKILL.md` is a standard agent skill (frontmatter `name`,
`description`, body), with sibling resources allowed anywhere under
`output/`. Future output *kinds* (e.g. a Fabro workflow) become siblings —
`output/` is a set of named distributables, SKILL.md is just the first.

**Version = content hash of the output tree:** sha256 over the sorted
`(path, file-sha256)` list under `output/`. Recording one is explicit
(`skillmaker version record`, or implicit before a run) and lands on the
journal — there is no version file in the bundle:

```jsonc
// journal event
{ "type": "skill.version_recorded",
  "payload": {
    "bundle": "frame-the-problem",
    "hash": "sha256:ab12…",
    "designHash": "sha256:cd34…",       // design.md at record time → drift hint
    "label": "v0.3"                      // optional human tag
  } }
```

**Drift hint** (replaces Protocol-E parity + resync cone): compare the live
`design.md` hash and `output/` hash against the latest recorded version →
`in-sync` / `design-changed` / `output-hand-edited` / `both`. Displayed,
never enforced — deliberate hand-finishing is legitimate; the model records
*that* and *when*, not that it's wrong.

### 2.8 Runs — `runs/<run-id>/`

A run = one fixture case × one recorded skill version × one provider(+model).
Mechanics: create temp workspace → copy `fixtures/<case>/files/` in →
install `output/` as the skill (e.g. `.claude/skills/<slug>/`) → launch the
provider via ACP with `case.prompt` → capture the session → diff the
workspace into `artifacts/`.

`run.json` (written at start, finalized at end, then immutable):

```jsonc
{
  "schemaVersion": 1,
  "id": "01JZX8M2E9V0Q4",               // ULID = directory name
  "bundle": "frame-the-problem",
  "kind": "eval",                       // eval | station — station runs do a state's work (§2.13)
  "station": null,                      // state id when kind = "station"
  "fixtureCase": "refusal-thin-input",  // eval runs only
  "skillVersionHash": "sha256:ab12…",
  "provider": "claude-code",
  "model": "claude-opus-4-6",           // as reported by the provider
  "startedAt": "2026-07-10T17:03:22Z",
  "endedAt": "2026-07-10T17:05:41Z",
  "status": "completed",                // running | completed | failed | infra-error
  "actor": { "kind": "user", "name": "jess" }   // who launched it
}
```

`infra-error` vs `failed` keeps the inherited infra/skill failure split (the
Tracker's best trick): auth/sandbox/connection faults never pollute pass
rates. `transcript.jsonl` is the raw ACP session update stream — the viewer
renders it for the read-out. **The grade is NOT in run.json** — grading is a
decision, so it's a journal event (§2.9), which also means regrades are
naturally append-only history.

### 2.9 The journal — `.skillmaker/events.jsonl`

Envelope [inherited mechanics: Alexandria ledger]:

```jsonc
{ "schemaVersion": 1,
  "id": "uuid",
  "type": "run.graded",
  "at": "2026-07-10T17:20:00Z",
  "actor": { "kind": "user", "name": "jess" },     // kind: user | agent | process; agents add "provider"
  "idempotencyKey": "grade:01JZX8M2E9V0Q4:1",
  "payload": { … } }
```

Append rules: validate → idempotency check (same key + same payload ⇒
no-op; same key + different payload ⇒ conflict error) → append one line.
Writes go only through the CLI/server, never freehand.

**Event catalog (v1):**

| Type | Payload | Notes |
|---|---|---|
| `bundle.created` | `{bundle}` | fired by `skillmaker new` |
| `bundle.stage_changed` | `{bundle, from, to, reason?, override?}` | the state-machine transition (§2.13); guards checked at append |
| `bundle.gate_decided` | `{bundle, gate: "publish", decision: "approved"\|"declined", basis}` | `basis` = free-text evidence summary shown in history |
| `bundle.archived` / `bundle.restored` | `{bundle}` | off/on the active board |
| `skill.version_recorded` | §2.7 | |
| `skill.published` | `{bundle, versionHash, target, url?}` | |
| `todo.opened` | `{todo: {…full record, §2.10}}` | |
| `todo.updated` | `{id, patch}` | shallow patch of mutable fields |
| `todo.status_changed` | `{id, from, to}` | terminal stamping derived at replay |
| `run.started` | `{run: {…run.json minus end fields}}` | mirrors run.json for replay-completeness |
| `run.completed` | `{id, status, endedAt}` | |
| `run.graded` | `{id, verdict: "pass"\|"fail"\|"partial", checks?: [{text, pass}], notes?}` | regrade = new event; latest wins, history kept |
| `station.started` | `{bundle, state, runId?}` | station work begins (§2.13); `runId` when agent-driven |
| `review.requested` | `{bundle, state, artifacts?: string[], question?}` | agent ends its turn; bundle enters `awaiting-review` [inherited: non-blocking pair] |
| `review.resolved` | `{bundle, state, decision: "approve"\|"revise", notes?}` | `approve` satisfies the forward guard; `revise` notes become the agent's next instruction |

Not journaled: file edits to sources/outputs (git is their history; reindex
scans them). The journal stays thin — ids and decisions, no fat content.

### 2.10 Todos — journal-native

The full record (materialized in the DB from `todo.*` events):

```ts
type Todo = {
  id: string;                      // "td-<ulid>"
  kind: "task" | "bug" | "improvement" | "eval";
  status: "open" | "in-progress" | "done" | "wont-do";   // terminal: done, wont-do
  title: string;
  detail?: string;
  checklist?: { text: string; done: boolean }[];
  priority: number;                // lower = more urgent; defaults: bug 10, eval 15, improvement 20, task 30
  bundle?: string;                 // app-level todos omit it
  created: string;
  terminalAt?: string;             // derived at replay: stamped entering terminal, cleared on reopen
  pinned?: boolean;
  archived?: boolean;              // derived: terminal + ≥7 days + not pinned  [inherited window]
  source: Actor;
};
```

Kept rules [inherited]: status ⊥ stage; terminal/archive/reopen mechanics;
priority → created → id sort. Dropped: exactly-one-testing-card-per-play.

### 2.11 SQLite — materialized views only

```sql
-- all rebuildable from files + journal via `skillmaker reindex`
CREATE TABLE bundles        (slug PK, name, one_liner, tags_json, created,
                             stage, substate, archived,       -- ← journal fold (§2.13; substate: working | awaiting-review)
                             design_hash, output_hash,        -- ← file scan
                             drift);                          -- ← computed
CREATE TABLE skill_versions (bundle, hash, design_hash, label, recorded_at,
                             PRIMARY KEY (bundle, hash));
CREATE TABLE fixtures       (bundle, case_name, class, risks_json, PRIMARY KEY (bundle, case_name));
CREATE TABLE risk_coverage  (bundle, risk_id, family, coverage, fixture_case);
CREATE TABLE runs           (id PK, bundle, fixture_case, version_hash,
                             provider, model, started_at, ended_at, status,
                             verdict, graded_at, graded_by);  -- ← latest run.graded
CREATE TABLE todos          (id PK, kind, status, title, detail, checklist_json,
                             priority, bundle, created, terminal_at, pinned, archived, source_json);
CREATE TABLE events         (id PK, type, at, actor_json, bundle, payload_json);  -- queryable journal mirror
CREATE VIEW  measurements AS                       -- law §1.5/§1.6: never pooled
  SELECT bundle, fixture_case, version_hash, provider, model,
         COUNT(*) AS n,
         AVG(verdict = 'pass') AS pass_rate
  FROM runs WHERE status = 'completed' AND verdict IS NOT NULL
  GROUP BY bundle, fixture_case, version_hash, provider, model;
-- + FTS5 index over design.md / research/ / SKILL.md for search
```

CI (rule-of-three when 0 failures, else binomial) computed in code at read
time, not stored.

### 2.12 Read-outs (the ported magic)

The graded read-out is a **viewer surface, not a stored artifact**: for a
chosen (bundle, version), it joins the risk-map coverage axis × the
measurements view per provider/model, lists runs per fixture with
transcript + artifacts inline, and offers the grading panel (verdict +
`case.json` `grading.checks` checklist + notes → one `run.graded` event).
Everything it shows is reconstructible, so nothing to keep in sync.
[ports: dry-runs/read-out.md + risk-map results axis + Play Testing lens]

### 2.13 The production state machine + stations (ruled 2026-07-10)

**Two workflows, two names — never conflated** [inherited lesson: the old
studio's Tier/Bank polysemy hot-spots]:

- **The skill's workflow** — what an agent does when *running* the skill.
  Different per skill. Lives as prose in `design.md` ("The workflow") and
  ships in SKILL.md — including human-checkpoint steps written in prose.
  (Existence proof: `front-of-house-walk` ran a gated, human-paired workflow
  with no Fabro at all.)
- **The production state machine** — how a skill gets *made*. Studio-owned,
  agent-first. This section.

**The machine is ONE — universal, defined in core.** Its shape (states,
legal transitions, guards) is the studio's identity and crosses all
bundles. What varies per bundle is the **station config**: how the work of
each state gets done. Universal machine, configurable stations. (The
example plays support the split: plays varied in how work got done per
stage, never in the stage set itself.)

**States** (= ruling F, reframed): `idea → researching → drafting →
evaluating → published`, plus `archived`. Each state has substates
`working | awaiting-review` — the [inherited] `ready` flag dissolved into
a proper substate (`review.requested` enters it; `review.resolved` leaves
it).

**Transitions** — journaled as `bundle.stage_changed`, each with a guard:

| Transition | Guard |
|---|---|
| forward one state | `review.resolved: approve` for the current state's work |
| `evaluating → published` | additionally `bundle.gate_decided: approved` (the publish gate, ruling C) |
| backward (any → earlier state) | always legal, journaled with a reason — regression is a modeled fact (evals regress, models change), not an embarrassment |
| any ↔ `archived` | `bundle.archived` / `bundle.restored` |

Guards are checked at append time; a manual `bundle.stage_changed` with
`override: true` remains legal for station-less bundles (imported skills,
quick captures).

**Stations** — per-bundle work config, `stations.json` (source class),
**copied — not referenced — from an app-level template** at
`skillmaker new`, so a bundle's config is frozen with the bundle and
William can hand out different templates per skill kind:

```jsonc
{
  "schemaVersion": 1,
  "template": "default",                    // provenance of the copy
  "stations": {
    "researching": { "doer": "agent",       // agent | human  [inherited: doer honesty]
                     "skill": "william/research-a-skill",  // skill the station-agent runs with
                     "produces": ["research/"], "review": true },
    "drafting":    { "doer": "agent", "skill": "william/draft-skill-md",
                     "produces": ["design.md", "output/SKILL.md"], "review": true },
    "evaluating":  { "doer": "agent", "produces": ["evals/", "runs/"], "review": true }
  }
}
```

Mechanics:

- **Agent-first (ruled):** stations default to agent doers, executed as
  ACP **station runs** (`Run.kind = "station"` — same execution record,
  engine, and transcript capture as eval runs). A station's `skill` is
  itself a skill bundle — the studio dogfoods its own product, and
  **William** ships as the product's agent with his own skills for writing
  skills (living in the self-hosted `skills/` workspace).
- **The non-blocking review pair** [inherited]: an agent finishes a
  station's unit of work, emits `review.requested`, and ends its turn —
  the bundle enters `awaiting-review`. The human resolves in the viewer:
  `approve` satisfies the forward guard; `revise` notes become the agent's
  next instruction at the same station. Human gates are data, never a
  blocked process.
- Progress lives on the journal (`station.started` / `review.requested` /
  `review.resolved` / guarded `bundle.stage_changed`); `stations.json` is
  just the plan; current state = journal fold.

### 2.14 The Skillbook — workspace-level output

The workspace projects a **skillbook**: auto-generated documentation for
the whole skill set. Same artifact class as SKILL.md (output), one level
up. No new entities — a generator over existing facts:

- Per-skill chapters from `design.md` (intent, triggers, the skill's
  workflow, failure hypotheses) — the *why* no marketplace listing has.
- **Receipts** from the measurements view: pass rates × n × CI per
  provider/model pinned to version hashes, with coverage gaps shown as
  honestly as passes [inherited: two-axis rule, now public-facing].
- Changelogs replayed from the journal (versions, publishes, gates).

Rendered two ways by one renderer: a live viewer tab (always current) and
`skillmaker book build` → a publishable static site.

## Part 3 — Further rulings (2026-07-10)

- **G. `runs/` are git-tracked** (yes by default; config escape hatch
  `trackRuns: false` retained). **Ruled.**
- **H. Journal lives at `.skillmaker/events.jsonl`.** **Ruled.**
- **I. Reindex validation surfaces warnings**, never hard-fails — hard CI
  gates were right for the old monorepo, wrong for a product. **Ruled.**
- **Self-hosting:** the skillmaker-studio repo carries its own Skillmaker
  workspace (root `skills/` + `.skillmaker/`) — the studio's own skills are
  developed in the studio, and its journal is real shared history from
  day one. (The Alexandria-Prime pattern.) **Ruled.**
- **Production is a state machine, not a step list** (§2.13): one universal
  machine in core (states + guarded transitions, backward moves legal);
  per-bundle variation lives only in station config (`stations.json`,
  copied from templates). **Ruled.**
- **Agent-first production:** stations default to agent doers driven over
  ACP from v1; **William** ships as the product's agent, with his own
  skill-writing skills living in the self-hosted workspace. **Ruled.**

## Part 4 — Open items

- Per-model output variants (ruling D extension): future `output/` gains
  named variant subtrees; versions/measurements already key on hash so no
  schema change — sketch when needed.
