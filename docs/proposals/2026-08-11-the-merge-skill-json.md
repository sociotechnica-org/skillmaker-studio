# THE MERGE — skill.json data-model review

2026-08-11 · drafted by Raven; v2 — director's rulings folded in
(2026-08-11); remaining open: per-risk grading (parked), drift-scoped
selection (parked).
Companion: `2026-08-11-architecture-review-runner.md` (layers, runner
contract, the Inspect swap). Research basis:
`docs/research/2026-08-11-eval-ecosystem-survey.md`.

**How to read this doc:** Part 1 inventories every structured file that
exists today, with real JSON pulled from real bundles on this machine.
Part 2 is the merged `skill.json` — a complete, real example, built by
actually merging those files. All ten review markers from v1 have been
ruled (2026-08-11); each ruling appears inline as **RULED**, stated as
decided. Part 3 is global config. Part 4 is the migration. Everything
unmarked is claimed as mechanical.

---

## Part 1 — What exists today (the real files)

Seven structured stores per skill/machine, plus two derived ones.

### 1a. `bundle.json` — identity (real: `skills/design-skill/`)

```json
{
  "schemaVersion": 1,
  "slug": "design-skill",
  "name": "Design Skill",
  "oneLiner": "",
  "tags": [],
  "created": "2026-07-30",
  "targets": ["claude-code"]
}
```

Notes: `oneLiner` is the birth-intent field (empty here — design-skill
predates it). `targets` means *agent platforms this skill is written
for* — an unfortunate name now that `publishTargets` (below) also
exists. Published bundles additionally grow:

```jsonc
  "publishTargets": [{ "audience": "user", "installedAt": "..." }]
```

### 1b. Root `evals.json` — the design layer (real: skill #2,
`company/skills/read-over-recent-transcripts-suggest-2/`, written by
design-skill; abridged to 2 of 7 hypotheses)

```json
{
  "failureHypotheses": [
    {
      "id": "RE-1",
      "failure": "Uses a cleaned summary or an isolated sentence as though it were raw, context-preserving evidence.",
      "probability": "Medium",
      "impact": "High",
      "mustNever": "The skill must never present a cleaned summary or isolated quote as direct raw-transcript evidence without a context check.",
      "proofSpecs": [
        {
          "name": "summary-conflicts-with-raw-transcript",
          "setup": "Provide a source document whose cleaned summary overstates or differs from the raw-transcript passage.",
          "expectedBehavior": "The skill grounds the candidate in the raw passage, retains the source reference, and does not present the summary's interpretation as direct evidence."
        }
      ]
    },
    {
      "id": "OUT-3",
      "failure": "Returns invented suggestions to meet a quota instead of an explicit empty result when no distinctive, safe idea is available.",
      "probability": "Medium",
      "impact": "Medium",
      "mustNever": "The skill must never invent or pad suggestions when no distinctive, safe idea is present.",
      "proofSpecs": [
        {
          "name": "nothing-worth-writing",
          "setup": "Provide transcripts with no distinctive and safe public insight.",
          "expectedBehavior": "The skill explicitly returns no suggestions instead of inventing or padding candidates."
        }
      ]
    }
  ]
}
```

Note how much richer the shipped reality is than the schema docs
suggest: `probability`, `impact`, `mustNever` are all there (design-skill
writes them; the tolerant reader passes them through). This is the
white-space layer — the survey confirmed no other tool has it.

### 1c. Per-fixture `case.json` (real:
`skills/william-draft-skill-md/evals/fixtures/trigger-basic/`)

```json
{
  "schemaVersion": 1,
  "case": "trigger-basic",
  "class": "trigger",
  "risks": ["IN-2"]
}
```

Minimal in practice. Fuller shape per `Fixtures.ts`: optional
`setup {files, env}`, `grading {answerKey, checks[]}`, `source`
(harvest provenance), legacy `prompt` (tolerated), dead `context`
(ignored). The prompt lives in sibling `prompt.md`; expected material in
`expected/answer-key.md`; input files in `files/`.

### 1d. `stations.json` — production line (real: `skills/design-skill/`)

```json
{
  "schemaVersion": 1,
  "template": "default",
  "stations": {
    "researching": {
      "doer": "agent",
      "skill": "william-research-a-skill",
      "produces": ["research/"],
      "review": true
    },
    "drafting": {
      "doer": "agent",
      "skill": "william-draft-skill-md",
      "produces": ["design.md", "output/SKILL.md"],
      "seeds": ["research/"],
      "review": true
    },
    "evaluating": {
      "doer": "agent",
      "produces": ["evals/", "runs/"],
      "seeds": ["research/", "design.md", "output/"],
      "review": true
    }
  }
}
```

Note this template predates two rulings: no design station wiring
(design-skill reaches chat via HELPER_SKILL_SLUGS, not stations), and
"researching includes design.md" isn't reflected in `produces`.
**RULED (R6): this file dies — see Part 2.**

### 1e. `runs/<id>/run.json` — execution record (real:
`skills/william-research-a-skill/runs/791a4742…/`)

```json
{
  "schemaVersion": 1,
  "id": "791a4742-3941-4a9b-949e-4fd39a88de39",
  "bundle": "william-research-a-skill",
  "kind": "eval",
  "station": null,
  "fixtureCase": "golden-basic",
  "skillVersionHash": "sha256:a5fa528985fa0025049aee7a8ce0660d72e0c7066d6d42efed6968ace7d1459d",
  "provider": "claude-code",
  "model": "",
  "startedAt": "2026-07-11T15:16:32.390Z",
  "endedAt": "2026-07-11T15:19:37.752Z",
  "status": "infra-error",
  "actor": { "kind": "user", "name": "Jess Martin" }
}
```

(A real infra-error, honestly excluded from measurements — the split at
work.) Sits beside `transcript.jsonl`, `response.md`, `artifacts/`.

### 1f. Journal `events.jsonl` — including grades (real:
`company/.skillmaker/events.jsonl`)

```json
{
  "schemaVersion": 1,
  "id": "8e07bb77-9a79-4fc2-b82a-3a4e1a33c771",
  "at": "2026-08-08T12:43:04.608Z",
  "actor": { "kind": "user", "name": "Jess Martin" },
  "type": "run.graded",
  "payload": {
    "id": "42c0de64-d157-41d7-badb-25a6ba85b1cc",
    "verdict": "pass",
    "notes": "Returned five ranked, source-grounded candidates; labeled the inferred angle, rejected generic and unsupported material, and met the answer key."
  }
}
```

Grades today live ONLY here (append-only, latest-wins at index build) —
there is no grade file beside the run. **RULED: git-visible grade files
are required.** `runs/<id>/grades/<grader>/grade.json` is the record;
the journal `run.graded` event is kept as the UI-liveness notification.
Grades cannot be journal-only.

### 1g. Machine registry (real: `~/.skillmaker-studio/config.json`)

```json
{
  "projects": [
    { "path": "/Users/jessmartin/Documents/code/skills" },
    { "path": "/Users/jessmartin/Documents/code/company" },
    { "path": "/Users/jessmartin/Documents/code/alexandria-internal" },
    { "path": "/Users/jessmartin/Documents/code/beads" }
  ]
}
```

### Derived (not sources): `studio.db` SQLite index (rebuilt from
files + journal; measurements are a view over runs), and legacy
`evals/risk-map.md` (read-side fallback only; no writer since
2026-08-08).

**The problem, visible:** a single skill's structured truth is spread
across 1a + 1b + 1c(×N) + 1d + publishTargets, with three different
join conventions (proofSpec.name→case dir, case.risks→hypothesis id,
stations→skill slugs) — none enforced at write time.

---

## Part 2 — THE MERGE: `skill.json`

One file at the bundle root. This is the real skill #2 merged — every
field below exists in the actual files above, except where marked NEW
or restructured per ruling.

```jsonc
{
  "schemaVersion": 2,                       // 1 = pre-merge files

  // ── identity & lifecycle ── (absorbs bundle.json)
  "skill": {
    "slug": "read-over-recent-transcripts-suggest-2",
    "name": "Read Over Recent Transcripts",
    "oneLiner": "Mine recent meeting transcripts for tweet-worthy insights with evidence.",
    "tags": [],
    "created": "2026-08-07",
    "harnesses": ["claude-code"],           // RULED (R1): renamed from bundle.json
    "stage": "evaluating"                   //   "targets" — "harnesses" aligns with
  },                                        //   smevals' "model-and-harness
                                            //   configuration" vocabulary.

  // RULED (R2): stages are DECLARED and live here in skill.json.
  // Transitions are gated on derived artifact existence. Derived
  // readiness = the same checks running continuously; a gate = the
  // check enforced at transition time. Gate table (RULED 2026-08-11):
  //
  //   idea → researching          HARD gate: `name` and `oneLiner`
  //                               (birth intent) non-empty — "how else
  //                               will you research"
  //   researching → drafting      HARD gate: design.md exists + non-empty
  //   drafting → evaluating       HARD gate: output/SKILL.md exists
  //   evaluating → published      SOFT gate: ≥1 realized case with ≥1
  //                               graded run — warn "publishing
  //                               unmeasured", never block (the Vision's
  //                               soft-gate ruling stands)
  //   any → archived              no gate
  //
  // NO DECLARED-VS-LIVE SPLIT (director, 2026-08-11): skill.json.stage
  // IS the stage — file = record, journal `bundle.stage_changed` event =
  // liveness notification, same pattern as grade files. INTERIM ONLY:
  // until the write-side tranche gives stage a writer (advance writes
  // skill.json), readers keep trusting the journal fold — because the
  // field has no writer yet, not because two truths exist.

  // ── the design layer ── (absorbs root evals.json)
  // RULED (R3): key is "design". MAJOR RESTRUCTURE ruled: proofSpecs
  // are absorbed into cases — a proof spec and a planned case are the
  // same thing at different maturities. Hypotheses point at cases by
  // name (pointers only); this hypothesis→case edge is the ONLY edge —
  // the old case.risks[] back-reference is REMOVED.
  "design": {
    "failureHypotheses": [
      {
        "id": "OUT-3",
        "failure": "Returns invented suggestions to meet a quota instead of an explicit empty result when no distinctive, safe idea is available.",
        "probability": "Medium",
        "impact": "Medium",
        "mustNever": "The skill must never invent or pad suggestions when no distinctive, safe idea is present.",
        "cases": ["nothing-worth-writing"]
      }
      // … six more, same shape (RE-1 → ["summary-conflicts-with-raw-transcript"], …)
    ]
  },
  // Coverage is DERIVED, never stored: a hypothesis is "covered" when
  // all its pointed cases are realized, "partial" when some are,
  // "gap" when none are. A case with no materials dir yet is "planned"
  // (a proof spec, in the old vocabulary). Shared cases across
  // hypotheses fall out free — two hypotheses may point at one case.

  // ── eval definitions ── (absorbs every per-case case.json AND the
  //    old proofSpecs)
  "evals": {
    "cases": [
      {
        "name": "nothing-worth-writing",    // == dir name under evals/cases/.
        "class": "empty",
        "setup": "Provide transcripts with no distinctive and safe public insight.",
        "expectedBehavior": "The skill explicitly returns no suggestions instead of inventing or padding candidates.",
        // ^ RULED (R3): `setup` (prose) and `expectedBehavior` come
        //   from the old proofSpec. No `risks[]` — hypothesis→case is
        //   the only edge. A case with no evals/cases/<name>/ dir yet
        //   is planned; realizing it = writing the materials.
        "expected": "expected.md",          // RULED (R4): renamed from
        "checks": [                         //   grading.answerKey (industry-
          {                                 //   universal term; free Braintrust
            "checker": "contains",          //   alignment)
            "text": "no suggestions"
          }
        ]
        // optional, unchanged in substance: the legacy structured
        // setup {files, env} yields its name to the prose field and
        // migrates to "sandbox": {"files": "files/", "env": {}}
        // (mechanical); "source": {"kind": "field-report", …} (harvest)
      }
      // … one per hypothesis-pointed case; realized bodies live in
      //   evals/cases/<name>/
    ],
    "configs": [                            // RULED (R5): configs STAY, but are
      {                                     // auto-registered by the door on
        "id": "cc-default",                 // first run against a new
        "harness": "claude-code",           // (harness, model) pair — never
        "model": "claude-sonnet-5"          // required up front. Renameable and
      }                                     // prunable. They are the measurement
    ]                                       // axis and the runner-picker's
  },                                        // data source.

  // ── distribution ── (absorbs publishTargets)
  "publish": {
    "targets": [{ "audience": "user", "installedAt": "2026-08-08T…" }]
  }

  // ── production line ── RULED (R6): stations.json DIES and no
  // stations section replaces it. The production line is CODE, not
  // config: which skill serves which stage lives in code —
  // HELPER_SKILL_SLUGS becomes the single home. skill.json carries no
  // stations block.
}
```

**Deliberately absent** (and why):

- **Runs** — immutable records, not skill state. They stay in `runs/`
  (architecture doc). skill.json is *current-state*; ruled: history
  deprioritized.
- **Grades/measurements** — records about runs, never skill state.
  RULED: git-visible grade files are required —
  `runs/<id>/grades/<grader>/grade.json` is the record; the journal
  `run.graded` event stays as UI-liveness notification only.
- **Stations** — RULED (R6): the production line is code, not config.
- **Versions** — journal + version records, unchanged.
- **Prose bodies** — SKILL.md, design.md, prompt.md, expected.md are
  files; skill.json holds references. Markdown renders, never sources.

**RULED (R7): cases are INLINE in skill.json.** Director intent
recorded: skill.json is the interim form of a future relational DB, so
the schema stays relational-clean — hypotheses→cases is the one
foreign-key edge; cases, runs, and grades key naturally (case name, run
id, grader). CLI doors are the writers; the conflict window is narrow.

**RULED (R8): the unit is `case`.** Directory becomes `evals/cases/`.

---

## Part 3 — Global config

Two machine-level files, cleanly split:

**`~/.skillmaker-studio/config.json` (exists)** — the machine registry.
Stays exactly as-is: which projects this machine knows. Nothing merges
into it; it's a directory, not a settings file.

**`~/.skillmaker-studio/settings.json` (new)** — machine-level
defaults that today have nowhere to live. **RULED (R9): fine to have
now.**

```jsonc
{
  "schemaVersion": 1,
  "defaults": {
    "harness": "claude-code",              // today: per-run flags/UI picker
    "model": "claude-sonnet-5",
    "runTimeoutSeconds": 600
  },
  "runner": { "engine": "bundled" }        // future: "inspect" etc.
}
```

Precedence when several exist: skill.json `configs[]` > project >
machine settings.

**Project-level settings** (a `.skillmaker/settings.json` next to the
journal) — **RULED (R10): allowed; build it when something needs it.**
Nothing does yet, so nothing ships now.

---

## Part 4 — The migration (one migration, not three)

Absorbs every pending rename in a single change (case.json→evals.json
rename ruling, claims-storage restructure, this consolidation).

**RULED: migration is an explicit, throwaway standalone script**
(`scripts/migrate-skill-json.ts`) — NOT a `skillmaker migrate` product
command, and NOT auto-on-write through the doors. Rationale:
pre-release, no real users; only this repo and 2–3 repos we all own
need migrating. Still one reviewable git diff per bundle, still
idempotent, still dry-runnable — just a script, not product surface.

1. The script reads 1a–1c + publishTargets, writes
   `skill.json` schemaVersion 2 (restructuring proofSpecs into cases
   and dropping case `risks[]` per R3), moves `evals/fixtures/` →
   `evals/cases/`, `expected/answer-key.md` → `expected.md`. It
   **deletes `stations.json` without replacement** (R6 — the
   production line lives in code, HELPER_SKILL_SLUGS). Old files
   deleted after write (git is the undo).
2. Tolerant readers (the EvalsJson.ts pattern) accept schemaVersion-1
   layouts for one release, warn, never hard-fail.
3. `risk-map.md` fallback reader survives one release, then drops.
4. Existing runs are NOT migrated (immutable records; readers handle
   both layouts).
5. The naming collision resolves itself: root `evals.json` is absorbed,
   per-case `case.json` is absorbed — no file named `evals.json`
   remains.

All ten review markers are now ruled, and the gate table is ruled; the
migration design is unblocked. Remaining open: per-risk grading
(parked), drift-scoped selection (parked).
