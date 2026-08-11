# THE MERGE — skill.json data-model review

2026-08-11 · drafted by Raven for the director's thorough review.
Companion: `2026-08-11-architecture-review-runner.md` (layers, runner
contract, the Inspect swap). Research basis:
`docs/research/2026-08-11-eval-ecosystem-survey.md`.

**How to read this doc:** Part 1 inventories every structured file that
exists today, with real JSON pulled from real bundles on this machine.
Part 2 is the merged `skill.json` — a complete, real example, built by
actually merging those files, with a ⚖️ REVIEW marker at every decision
that is yours to make. Part 3 is global config. Part 4 is the migration.
Work through the ⚖️ markers; everything unmarked is claimed as
mechanical.

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
there is no grade file beside the run. The architecture doc proposes a
per-run `grades/` lane; the journal event stays as the notification
side-channel, per the ruling that history-tracking is deprioritized but
"two doors, one journal" remains for UI liveness.

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
field below exists in the actual files above, except where marked NEW.

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
    "agents": ["claude-code"],              // ⚖️ REVIEW 1: renamed from bundle.json
    "stage": "evaluating"                   //   "targets" (collides with publish).
  },                                        //   Keep "targets"? Call it "platforms"?

  // ⚖️ REVIEW 2: "stage" moving INTO skill.json makes the declared stage a
  // fact of the skill record. The open declared-vs-derived stages question
  // (#200 remainder) is NOT settled by this doc — but note that if stages
  // ever become derived, this field becomes a cache or disappears. Merge
  // anyway, or leave stage in the journal only?

  // ── the design layer ── (absorbs root evals.json, byte-identical shape)
  "design": {
    "failureHypotheses": [
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
      // … six more, exactly as design-skill wrote them
    ]
  },
  // ⚖️ REVIEW 3: key it "design" (this doc: evals are born from design —
  // the enterprise-lifecycle story told structurally) or "claims" (what
  // the viewer calls them) or keep "evals"-adjacent naming?

  // ── eval definitions ── (absorbs every per-case case.json)
  "evals": {
    "cases": [
      {
        "name": "nothing-worth-writing",    // == proofSpec.name == dir name.
        "class": "empty",                   //   THE join, now explicit and
        "risks": ["OUT-3"],                 //   CLI-enforced at write time.
        "expected": "expected.md",          // ⚖️ REVIEW 4: renamed from
        "checks": [                         //   grading.answerKey (industry-
          {                                 //   universal term; free Braintrust
            "checker": "contains",          //   alignment)
            "text": "no suggestions"
          }
        ]
        // optional, unchanged: "setup": {"files": "files/", "env": {}},
        // "source": {"kind": "field-report", "eventId": "…"}  (harvest)
      }
      // … one per case dir; bodies stay in evals/cases/<name>/
    ],
    "configs": [                            // NEW (smevals' Config): names the
      {                                     // model-and-harness setup once,
        "id": "cc-default",                 // instead of per-run flags
        "provider": "claude-code",
        "model": "claude-sonnet-5"
      }
    ]
    // ⚖️ REVIEW 5: configs — worth having now (they complete the
    // measurement key and give runs a stable axis), or premature?
  },

  // ── distribution ── (absorbs publishTargets)
  "publish": {
    "targets": [{ "audience": "user", "installedAt": "2026-08-08T…" }]
  },

  // ── production line ── (absorbs stations.json)
  "stations": {
    "template": "default",
    "researching": { "doer": "agent", "skill": "william-research-a-skill", "produces": ["research/", "design.md"], "review": true },
    "drafting":    { "doer": "agent", "skill": "william-draft-skill-md", "produces": ["output/SKILL.md"], "seeds": ["research/", "design.md"], "review": true },
    "evaluating":  { "doer": "agent", "produces": ["evals/", "runs/"], "seeds": ["research/", "design.md", "output/"], "review": true }
  }
  // ⚖️ REVIEW 6: while merging, fix the template to the method ruling
  // (researching produces design.md; drafting seeds from it) — or migrate
  // byte-faithful and fix the template separately?
}
```

**Deliberately absent** (and why):

- **Runs** — immutable records, not skill state. They stay in `runs/`
  (architecture doc). skill.json is *current-state*; ruled: history
  deprioritized.
- **Grades/measurements** — computed/appended over runs, never skill
  state.
- **Versions** — journal + version records, unchanged.
- **Prose bodies** — SKILL.md, design.md, prompt.md, expected.md are
  files; skill.json holds references. Markdown renders, never sources.

⚖️ REVIEW 7 (the big structural one): **cases inline vs. per-case
files.** This draft inlines all case *metadata* into skill.json (the
"pull it all into one file" instinct). The cost: skill.json becomes the
merge-conflict hotspot when an agent adds cases while a human edits
identity fields; and CLI doors must be the only writer or conflicts get
worse. The alternative: skill.json holds the case *index* (names only)
and per-case metadata stays in `evals/cases/<name>/case.json`. My
recommendation is inline — the whole point is one record, agents
already go through doors, and the conflict window is narrow — but this
is the decision most expensive to reverse.

⚖️ REVIEW 8: **naming the unit.** This doc says `case` (industry
convergence; `case.json` already used the word; smevals says Task).
Directory becomes `evals/cases/`. Sign off or veto.

---

## Part 3 — Global config

Two machine-level files, cleanly split:

**`~/.skillmaker-studio/config.json` (exists)** — the machine registry.
Stays exactly as-is: which projects this machine knows. Nothing merges
into it; it's a directory, not a settings file.

**`~/.skillmaker-studio/settings.json` (proposed, does not exist)** —
machine-level defaults that today have nowhere to live:

```jsonc
{
  "schemaVersion": 1,
  "defaults": {
    "provider": "claude-code",             // today: per-run flags/UI picker
    "model": "claude-sonnet-5",
    "runTimeoutSeconds": 600
  },
  "runner": { "engine": "bundled" }        // future: "inspect" etc.
}
```

⚖️ REVIEW 9: Is this file wanted *now*, or does it wait until a second
runner exists? (The director's "skillmaker-config.json (or whatever we
call it)" comment prompted it. Precedence when both exist: skill.json
`configs[]` > project > machine settings.)

⚖️ REVIEW 10: project-level config (a `.skillmaker/settings.json` next
to the journal) — wanted, or is machine + skill enough? Registered
projects currently have zero project-scoped settings.

---

## Part 4 — The migration (one migration, not three)

Absorbs every pending rename in a single change (case.json→evals.json
rename ruling, claims-storage restructure, this consolidation):

1. `skillmaker migrate` (or first write through any door): reads 1a–1d
   + publishTargets, writes `skill.json` schemaVersion 2, moves
   `evals/fixtures/` → `evals/cases/`, `expected/answer-key.md` →
   `expected.md`. Old files deleted after write (git is the undo).
2. Tolerant readers (the EvalsJson.ts pattern) accept schemaVersion-1
   layouts for one release, warn, never hard-fail.
3. `risk-map.md` fallback reader survives one release, then drops.
4. Existing runs are NOT migrated (immutable records; readers handle
   both layouts).
5. The naming collision resolves itself: root `evals.json` is absorbed,
   per-case `case.json` is absorbed — no file named `evals.json`
   remains.

Everything in Part 2/3 marked ⚖️ blocks the migration design; nothing
else does. Ten markers total — that's the review.
