---
title: The Skill Bundle
description: What a Skill Bundle is made of, and the source/output/record law.
---

A **Skill Bundle** is the durable asset: research, design thinking, eval
fixtures, run records, and status, tracked together under one slug. A
`SKILL.md` file is just one of the things it *produces* — an **output**, not
the bundle itself.

## Artifact classes

Every file in a bundle belongs to exactly one of three classes, and the
class determines who writes it and whether it's allowed to drift:

| Class | What it means | Examples |
|---|---|---|
| **Source** | Authored by a human or agent; the thing you edit | `design.md`, `research/*.md`, `evals/risk-map.md`, `evals/fixtures/<case>/case.json` |
| **Output** | Produced from sources; may be hand-finished afterward | `output/SKILL.md`, other bundled resources under `output/` |
| **Record** | Immutable evidence, never edited by hand | `runs/<run-id>/run.json`, `runs/<run-id>/transcript.jsonl`, `runs/<run-id>/artifacts/` |

This is an inherited law from the predecessor studio: sources are authored,
outputs are produced (and may be hand-finished), records are immutable
evidence. It's why `output/SKILL.md` can drift from `design.md` without
anything being "wrong" — see [Versions and drift](/concepts/versions-and-drift/).

## Anatomy of a bundle

`skillmaker new <slug>` scaffolds `skills/<slug>/`:

```text
skills/<slug>/
  bundle.json              # identity only: slug, name, one-liner, tags, targets
  design.md                # source: the skill's workflow thinking
  stations.json             # per-state work config, copied from a template
  research/                # source: free-form markdown
    *.md
  evals/
    risk-map.md              # source: authored coverage axis (no results column)
    fixtures/
      <case>/
        case.json             # source: the task's classification
        prompt.md             # source: the task prompt sent to the agent
        files/…               # source: workspace inputs copied into the run
        expected/
          answer-key.md        # source: grading key, never shown to the agent
  output/
    SKILL.md                 # output: the distributable skill
    …                         # output: bundled resources (scripts, refs)
  runs/
    <run-id>/                # record: immutable once the run ends
      run.json                 # execution metadata
      transcript.jsonl          # the agent session log
      artifacts/…               # files the agent produced (a workspace diff)
```

### `bundle.json` — identity only

```jsonc
{
  "schemaVersion": 1,
  "slug": "frame-the-problem",     // = directory name; kebab-case; immutable
  "name": "Frame the Problem",
  "oneLiner": "",
  "tags": [],
  "created": "2026-07-11",
  "targets": ["claude-code"]       // advisory: which agents it's written for
}
```

Nothing mutable-in-anger lives here — no stage, no status. That state lives
on the journal (see [The journal](/concepts/journal/)) and is folded into
the bundle's current stage/substate at read time. Renames touch `name`; the
`slug` is forever, because it's the key everything else — fixtures, runs,
journal events — refers back to.

### `design.md` — the source of the skill's logic

A recommended (not enforced) section skeleton:

```markdown
---
bundle: frame-the-problem
---
# Design — Frame the Problem

## Intent
What outcome this skill produces and for whom.

## When to use / triggers
The situations that should activate it (seeds SKILL.md's description).

## The workflow
The step-by-step logic, in prose. Numbered steps, decision points, what
the agent must never do.

## Failure hypotheses
| # | How it could fail | Risk family |
|---|---|---|
| 1 | Invents facts when input is thin | RE |

## Proof spec
Which fixture cases the failure hypotheses demand (seeds evals/).
```

### `stations.json` — per-bundle work config

Copied (not referenced) from an app-level template at `skillmaker new`, so a
bundle's config is frozen at creation time:

```jsonc
{
  "schemaVersion": 1,
  "template": "default",
  "stations": {
    "researching": { "doer": "agent", "skill": "william-research-a-skill",
                     "produces": ["research/"], "review": true },
    "drafting":    { "doer": "agent", "skill": "william-draft-skill-md",
                     "produces": ["design.md", "output/SKILL.md"], "review": true },
    "evaluating":  { "doer": "agent", "produces": ["evals/", "runs/"], "review": true }
  }
}
```

A station's `skill` names another Skill Bundle in the **same workspace**
(bundle slugs never contain `/`), not a path — `skillmaker start`'s own
`StationEngine` resolves it and installs that bundle's `output/` as the
ACP skill for the run.

Stations describe **how the work of each production state gets done**.
Agent-driven station execution (`skillmaker station run`) is built and, in
this repo's own self-hosted workspace, in real use — see the
[Roadmap](/roadmap/) for what's shipped where.

## Two workflows, never conflated

Skillmaker Studio deliberately keeps two different "workflow" concepts
apart:

- **The skill's workflow** — what an agent does when *running* the skill
  you've built. Different per skill. Lives as prose in `design.md` and
  ships in `SKILL.md`.
- **The production state machine** — how a skill gets *made* inside the
  studio. One universal machine, defined in `@skillmaker/core`, the same
  for every bundle. See [The production state machine](/concepts/state-machine/).
