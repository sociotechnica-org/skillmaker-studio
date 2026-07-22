---
name: to-tickets
description: >
  Decompose a decided plan, spec, issue, or design conversation into
  dependency-ordered tracer-bullet tickets written as local markdown files.
  Use when asked to "break this into tickets," "create implementation tickets,"
  or "decompose into work items" — any time a decided scope needs slicing into
  executable vertical-slice tickets with blocking edges.
---

# To Tickets

Decompose an already-decided scope into **vertical-slice implementation tickets** with dependency ordering. Each ticket is a thin, end-to-end tracer bullet through every affected layer. You produce local markdown files — you never talk to a tracker API.

## Process

### 1. Gather context

Work from whatever is already in the conversation. If the user passes a reference (spec path, issue URL), fetch and read it.

**Stop if input is too vague.** If there is no clear what-to-build and no scope boundaries, do not invent tickets. Tell the user what's missing:

> I need at least: what to build, why, scope boundaries, and any constraints (tech stack, patterns). Can you provide more detail?

If the user has already sketched a partial breakdown, work with that structure — do not discard it and start from scratch.

### 2. Explore the codebase (optional)

If the conversation already contains file paths, function names, or architectural references specific to the project, skip this step.

Otherwise, explore the codebase to:
- Learn the project's domain vocabulary (use its canonical nouns in tickets — never invent synonyms)
- Find existing patterns, ADRs, and conventions the tickets should respect
- Identify prefactoring opportunities ("make the change easy, then make the easy change")

### 3. Confirm output location

Ask the user where to write tickets. Default to `tickets/<slug>/` relative to the project root. Derive the slug from the scope description. One question, one line:

> I'll write tickets to `tickets/<slug>/`. OK, or different path?

Never use a hidden dot-directory. Never cache the answer.

### 4. Draft vertical slices

Break the work into tickets. Each ticket must follow these rules:

<vertical-slice-rules>
- Each ticket cuts a narrow but COMPLETE path through every affected layer (schema, API, UI, tests) — vertical, NOT a horizontal slice of one layer.
- A completed ticket is independently demoable or verifiable.
- Prefactoring tickets come before feature slices.
- The first ticket in the graph should reach a demoable state as early as possible — do not stack multiple horizontal foundation tickets before any user-visible value.
- One capability per ticket. If a ticket bundles two distinct user-visible changes, split it.
- Each ticket should be implementable by a fresh agent in one context-window pass.
</vertical-slice-rules>

<wide-refactor-exception>
When a single mechanical change (rename, retype) fans across the entire codebase, do NOT force it into a vertical slice. Sequence as expand-contract:
1. **Expand** — add the new form beside the old so nothing breaks (one ticket).
2. **Migrate** — convert call sites in batches sized by blast radius, each batch its own ticket blocked by expand, keeping CI green batch to batch.
3. **Contract** — delete the old form once no caller remains, blocked by all migrate batches.
If batches cannot individually stay green, use an integration branch with a final integrate-and-verify ticket.
</wide-refactor-exception>

**Blocking edges:**
- `blocked-by` means "cannot start until these are done."
- Tickets with no blockers form the DAG frontier — they can start immediately.
- Distinguish "blocked by" from "related to." Test: "Does this ticket literally *cannot start* until the other finishes?" If the answer is "it would be easier but not impossible," that is NOT a blocking edge.

**Ticket template — one file per ticket, named `NN-slug.md`:**

```markdown
---
id: NN
title: "<ticket title>"
blocked-by: []
---

## What to build

<End-to-end behavior from the user's perspective. Not a layer-by-layer list.
For spikes: the question to answer and the deliverable artifact.>

## Acceptance criteria

- [ ] <observable criterion — something you can see, run, or query>
- [ ] <at least one negative case: "Does not...">
- [ ] <at least one idempotency/re-run case where applicable>

## Decisions

<Forks this ticket closes — interface contracts, param names, precedence rules.
Freeze as literal examples (URLs, commands, JSON shapes, type signatures), not prose.
Omit this section if no decisions to freeze.>

## Scope fence

<What this ticket does NOT touch. Aim at the riskiest over-reach — blast radius,
architecture boundaries, concept boundaries.>
```

**YAML frontmatter rules:**
- `id` matches the NN in the filename: `01`, `02`, etc.
- `blocked-by` lists IDs: `[01, 03]`.
- **Never include a `blocks` field.** Forward edges are derivable from `blocked-by` and must never be stored — redundant data drifts.

**Content quality rules:**
- Every acceptance criterion must be observable (can be seen, run, or queried). No vague criteria like "works well" or "handles errors properly."
- Files appear only as orientation ("Relevant current files:"), never in acceptance criteria and never as edit recipes.
- Use the project's canonical nouns. Do not invent synonyms.
- Decision-encoding snippets (schemas, type shapes, state machines) may be inlined when more precise than prose — note they came from a prototype, trim to decision-rich parts.

### 5. Validate

Before presenting tickets to the user, run two validation passes:

**DAG validation:**
- Verify no cycles exist in the blocking-edge graph. Fix any you find.
- Verify every ID in `blocked-by` fields references an existing ticket.
- Check for orphan tickets (block nothing and blocked by nothing) — they may be valid leaf work or may indicate a missing edge.
- Flag suspiciously linear graphs (every ticket blocked by the previous) and check whether parallelism is possible.

**Per-ticket quality check:**
- [ ] Every acceptance criterion is observable
- [ ] At least one negative case ("does not...") where applicable
- [ ] At least one idempotency/re-run case where applicable
- [ ] Interfaces frozen as literal examples in Decisions, not prose
- [ ] Scope fence present and aimed at the riskiest over-reach
- [ ] No file-edit recipes in acceptance criteria
- [ ] Uses project's canonical nouns — no invented synonyms
- [ ] One capability only — if it bundles two changes, split it

Fix every failure before presenting. Do not punt quality issues to the user.

### 6. Quiz the user

**Large-scope nudge:** If the decomposition produces 20 or more tickets, warn before starting the quiz:

> This produced N tickets. That may be too large for one pass — would you like to split the scope and decompose in parts, or proceed with the full set?

**Single-ticket case:** If decomposition produces exactly one ticket, say so. Do not artificially split.

**Wave-based presentation:** Present tickets in dependency waves — not one flat list.

1. Show wave 1: the DAG frontier (tickets with no blockers).
2. For each ticket in the wave, show:
   - **Title** — short descriptive name
   - **Blocked by** — which approved tickets gate it (or "None" for wave 1)
   - **What it delivers** — the end-to-end behavior
3. After the wave list, show forward edges: "Ticket 03 unblocks: 05, 07."
4. Ask:
   - Are these tickets right? (approve all / redo specific tickets / split or merge)
   - Are the blocking edges correct?
5. Only proceed to the next wave after the current wave is approved.
6. If a ticket is revised and its blocking edges change, re-derive subsequent waves. Approved waves are locked.

Iterate until all waves are approved.

### 7. Publish

Write one markdown file per approved ticket to the confirmed output location. Number sequentially in dependency order (blockers first; within a wave, order by conceptual flow).

After writing all files, render a DAG summary with forward edges computed from `blocked-by`, so the user sees the complete graph.

Then ask: write to disk only, or also hand to a tracker integration the session already has? The skill's output is tracker-agnostic markdown — if the user wants tracker publishing, produce the content for the session to publish.

## Constraints

- **Never publish without user approval.** The quiz step is not optional.
- **Never talk to a tracker API.**
- **Never store `blocks` (forward edges) in ticket files.**
- **Never invent tickets when input is too vague.** Explain what's missing instead.
- **Never embed stale file paths** in tickets. Exception: decision-encoding snippets with a prototype note.
- **Never use a dot-directory** for ticket output.
- **Never skip validation.** Fix quality issues before presenting.
