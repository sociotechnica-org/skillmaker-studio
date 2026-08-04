Goal: GitHub Issue #196: Chat preamble claims guidance skills are installed when seeding installed nothing

Issue URL: https://github.com/sociotechnica-org/skillmaker-studio/issues/196

## Summary

The chat preamble tells every agent "Your guidance skills are installed in your
agent home -- read the relevant william-* skill before acting." When seeding
installed nothing, that sentence is false, and the agent does what a competent
agent should: it goes looking for the skills it was promised. `prepareAgentHome`
already returns exactly the fact needed to tell the truth — `installedHelpers` —
and the call site throws it away.

## Motivation / Problem

An instruction that names an artifact which isn't there is worse than no
instruction: it converts a missing dependency into a filesystem search. In the
live session that produced this ticket, the agent's first move was
`ls ~/.skillmaker/agent-home/claude-code/skills/`, and when that came back
empty it escalated to `find / -maxdepth 8 -type d -iname "william-*"` and a
sweep of the operator's other repos. Each of those is a path outside the
project, so each one raised a permission card.

This is a *distinct* defect from the seeding bug (#190). Fixing #190 makes the
helpers present in shipped builds — but a source checkout with no packaged
skills directory, or a future helper slug that fails to resolve, will still be
announced as installed. The preamble should assert only what is true at the
moment it is written.

## Observed behavior

Fresh project on v0.6.2, chat session started on a new bundle. The agent home
contains no `skills/` directory. The preamble nonetheless states the skills are
installed, and the session opens with a multi-command hunt across the machine
for `william-*` before any bundle work begins.

## Current shape

The claim, `packages/cli/src/server/ChatSessions.ts:324`:

```ts
    `- Your guidance skills are installed in your agent home -- read the relevant william-* skill before acting.`,
```

It is unconditional — a constant line in the preamble array, with no input from
whether seeding succeeded.

Meanwhile `prepareAgentHome` computes and returns precisely that
(`ChatSessions.ts:160`, `:179-181`):

```ts
): { readonly home: string; readonly installedHelpers: ReadonlyArray<string> } => {
```
```ts
    installed.push(slug);
  }
  return { home, installedHelpers: installed };
```

and both call sites discard it — `ChatSessions.ts:598` and `:793`:

```ts
    const { home } = prepareAgentHome(provider, this.root, this.config.skillsDir);
```

The trap worth naming: the information needed to be honest is already computed,
already returned, and already at the call site. This is not a missing capability;
it is a discarded return value.

## Proposed contract

The helper line is conditional on what actually installed:

| `installedHelpers` | Preamble line |
|---|---|
| non-empty | `- Your guidance skills (<slugs>) are installed in your agent home -- read the relevant one before acting.` |
| empty | line omitted entirely |

**Decisions:**

- When helpers installed, the line **names the slugs actually present**, so the
  agent reads what exists rather than guessing at a family name.
- When none installed, the line is **omitted**, not replaced with an apology.
  An agent told nothing about guidance skills proceeds on the bundle; an agent
  told they are "missing" may go hunting anyway.
- Partial installs name only the slugs that landed.
- `installedHelpers` is threaded to the preamble builder. `PreambleContext`
  gains a field; no other preamble line changes.
- The re-orientation preamble (`buildChatReorientation`, `ChatSessions.ts:349`)
  does not mention helpers today and does not gain a mention.
- No UI, no journal event, no warning surface. The scope is the preamble string.

## Acceptance criteria

- [ ] With helpers installed, the preamble states they are installed and names
      the installed slugs.
- [ ] With no helpers installed, the preamble contains no sentence asserting
      guidance skills are available anywhere.
- [ ] Partial install: only the slugs that actually landed are named.
- [ ] Negative: the preamble never names a slug absent from the agent home.
- [ ] Regression: every other preamble line — bundle layout, pipeline, CLI
      guidance, direct-in-project warning, and the derived-stage "current step"
      sentence — is byte-identical to today.
- [ ] Regression: `packages/cli/test/ChatPreamble.test.ts` passes, extended
      rather than rewritten.
- [ ] Regression: `PREAMBLE_SENTINEL` is unchanged — the viewer splits replayed
      first prompts on it (`chatModel.ts`).
- [ ] Tests cover: helpers-present, helpers-absent, and partial-install.

## Implementation notes

Both call sites already destructure the result; the change is to keep the second
field and pass it through. Prefer threading it into `PreambleContext` over
recomputing installation state inside the preamble builder — the builder is
deliberately synchronous and filesystem-light.

Scope fences:

- **Do not fix the seeding here.** That is #190. This issue is about the
  preamble telling the truth about whatever seeding did.
- **Do not add a user-facing warning.** A missing helper is not a condition the
  director needs a banner for.
- **Do not change `PREAMBLE_SENTINEL` or the separator** — the viewer parses on
  both.

Relevant current files, as orientation only:

- `packages/cli/src/server/ChatSessions.ts` — the claim (:324), the preamble
  builder (:320-329), `prepareAgentHome` (:156-182), call sites (:598, :793)
- `packages/cli/test/ChatPreamble.test.ts` — existing coverage

---

**Related:** #190 (packaged-skills fallback for the agent home). #190 makes the
helpers present; this makes the preamble honest when they aren't.


Implement exactly this issue. Verify every claim in the issue against the current code before acting on it; the issue is a report, not a spec — the code is the truth. Stay minimal: fix the reported defect with tests, nothing adjacent.

Run ID: 01KZ77BKMTF836C1KHDHAES1M2
Pipeline progress: 3 of 5 stages completed

## Stage: scope
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-sol
- Response:
  > Created the durable implementation plan at [2026-08-04-honest-chat-helper-preamble.md](/home/daytona/workspace/skillmaker-studio/docs/proposals/2026-08-04-honest-chat-helper-preamble.md).
  > 
  > It verifies the current data flow, scopes changes to chat session state and preamble construction, and covers helpers-present, helpers-absent, partial installation, both fresh-prompt paths, and byte-identical regressions. No implementation files were edited; the current focused test baseline passes all 20 tests.
  > 
  > Plan ready for implementation: docs/proposals/2026-08-04-honest-chat-helper-preamble.md

## Stage: implement
- Status: succeeded
- Handler: agent
- Model: gpt-5.6-terra
- Response:
  > Implemented Issue #196 in the CLI chat-session flow.
  > 
  > - `prepareAgentHome`’s actual `installedHelpers` result is retained on the live session and passed to both fresh full-preamble paths.
  > - The guidance bullet now appears only when helpers installed, names only those slugs in returned order, and is omitted entirely when none installed.
  > - Re-orientation remains unchanged; sentinel and separator are unchanged.
  > - Extended [ChatPreamble.test.ts](/home/daytona/workspace/skillmaker-studio/packages/cli/test/ChatPreamble.test.ts) for helpers present, absent, partial, and byte-identical non-helper content.
  > - Extended [chat-sessions.e2e.test.ts](/home/daytona/workspace/skillmaker-studio/test/e2e/chat-sessions.e2e.test.ts) to cover the partial real session handoff in both first-message and agent-first paths.
  > 
  > Validation:
  > 
  > - Passed: `bunx tsc --noEmit -p packages/core`
  > - Passed: `bunx tsc --noEmit -p packages/cli`
  > - Passed: focused preamble tests (23 tests)
  > - Passed: focused chat-session E2E (8 tests)
  > - Passed: `bun run build:viewer` (needed to make E2E server available)
  > - Passed: `bun test test/e2e --timeout 30000` (370 passed, 16 expected skips)
  > 
  > One required gate remains blocked by an unrelated, reproducible existing failure:
  > 
  > - `bun test packages` fails only at `packages/cli/test/JournalWatcher.test.ts`, `watchJournal > fires (debounced) on appends to an existing journal`—the callback never fires within its 3-second wait. All 1,062 other package tests passed. I left that watcher behavior untouched to keep this issue scoped.

## Stage: validate_gates
- Status: succeeded
- Handler: command
- Script: `./.fabro/scripts/fabro-validate`
- Output:
  ```
  (1679 lines omitted)
  (pass) card-fidelity round 2: GET /api/bundles/:slug/fixtures/:case for an output-dir bundle > serves the parsed case + prompt.md content; an unknown case 404s [1.00ms]
  
  test/e2e/unverified-badge.e2e.test.ts:
  (pass) a plain `new`-scaffolded bundle (never received) never badges Unverified > skillmaker new never sets everReceived, so the catalog entry is never Unverified, even with zero measurements [247.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > receives and routes a genuinely new crate [650.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/catalog shows the badge -- received, zero measurements ever [19.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > GET /api/intake's recentlyRouted tail shows the badge on this crate's row while it holds [22.00ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > run -> grade (pass) -> the badge clears on both the catalog and the recentlyRouted tail [1698.01ms]
  (pass) receive -> route new -> the resulting bundle badges Unverified > a version bump (route upgrade from a second crate) does NOT resurrect the badge -- first measurement EVER clears, for good [658.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > salvaging a crate against the already-cleared arrived-skill bundle leaves its badge alone [707.00ms]
  (pass) route salvage grants no identity: it never touches an existing bundle's own badge > a fresh receive+salvage naming a NEVER-measured bundle also never badges the row -- salvage always disqualifies [934.00ms]
  
  test/e2e/version-snapshots.e2e.test.ts:
  (pass) version snapshots through the CLI door > version record keeps design.md + output/ under .skillmaker/versions/<bare-hash>/ [217.00ms]
  (pass) version snapshots through the CLI door > re-recording identical content is already_appended -- the snapshot never registers as drift of what it recorded [275.00ms]
  (pass) version snapshots through the CLI door > version show lists the snapshot's files, by full hash, bare hex, or prefix [553.00ms]
  (pass) version snapshots through the CLI door > version show is honest about an unknown hash [252.00ms]
  (pass) version snapshots over HTTP > bundle detail's versions[] carries snapshot: true for a kept version [29.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/files lists the kept content (bare hex works) [1.00ms]
  (pass) version snapshots over HTTP > GET versions/:hash/file reads one snapshot file [2.00ms]
  (pass) version snapshots over HTTP > traversal and outside-the-snapshot paths 404, never leak [7.00ms]
  (pass) version snapshots over HTTP > the files-tab walk does not recurse into snapshots [3.00ms]
  (pass) pre-snapshot receipts stay honest > a receipt without kept content reads snapshot: false, 404s on files, and version show explains why [298.00ms]
  (pass) record-version endpoint snapshots too (same core path) > POST record-version after a content change keeps the NEW content under a NEW hash [25.00ms]
  
  16 tests skipped:
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/health reports ok
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET /api/bundles shows the bundle created via the binary
  (skip) skillmaker distributed binary: golden path (Phase 12a) > GET / serves the viewer HTML from the standalone viewer-dist/
  (skip) skillmaker distributed binary: golden path (Phase 12a) > claim file exists at the started port
  (skip) skillmaker distributed binary: golden path (Phase 12a) > SIGTERM stops the binary cleanly and removes the claim file
  (skip) skillmaker distributed binary: golden path (Phase 12a) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > a real station run drafts output/SKILL.md from design.md via william-draft-skill-md (or reports a classified failure, but never hangs)
  (skip) skillmaker station run: REAL claude-code-acp adapter, William's drafting skill (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > a real run against codex-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL codex-acp adapter (SKILLMAKER_REAL_CODEX=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > a real run against claude-agent-acp completes (or reports a classified failure, but never hangs)
  (skip) skillmaker run: REAL claude-agent-acp adapter (SKILLMAKER_REAL_ACP=1) > (unnamed)
  
   370 pass
   16 skip
   0 fail
   1635 expect() calls
  Ran 386 tests across 48 files. [155.04s]
  == Build viewer: skipped (no packages/viewer changes) ==
  All repo gates passed.
  ```


# ReviewJudge

You are the single review-and-verdict gate before the PR. Review the
implementation diff against the scope plan (under `docs/proposals/`, named
by the scope stage) and the house rules, read the gates output from the
previous stage, and deliver ONE verdict. Do not edit any files.

Check:

- The diff stays within the plan's scope and package boundaries: domain
  logic and schemas in `packages/core`, deterministic CLI/server behavior
  in `packages/cli`, browser UI in `packages/viewer`.
- Comments are plain English prose explaining WHY, citing issues, dated
  proposals, and rulings (`packages/core/src/Todo.ts` is the standard).
- Behavior changes have tests (black-box CLI tests for CLI behavior,
  `test/e2e` for server-surface changes).
- No files under `docs/library` were freehand-edited outside an approved
  library migration.
- The deterministic gates output shows the repo gates passed on the final
  diff.

Grading bar — this line is load-bearing: a mergeable change with noted
imperfections is a PASSING grade — perfectionism is the expensive failure
mode; note imperfections in the PR body instead of bouncing. Only route
Fix for real defects: broken or untested behavior, scope/plan mismatch,
boundary violations, failing gates. Style nits, minor gaps, and "could be
better" observations go in a short "Imperfections to note in the PR body"
list in your response, which the Prepare PR stage will include.

Verdicts (exactly one):

- **ready** — the change is mergeable. List any imperfections for the PR
  body, then route to Prepare PR.
- **fix** — a real defect blocks merge. Allowed AT MOST ONCE per run (the
  graph enforces this: this node runs at most twice, so on your second
  run Fix is off the table — choose ready or surface). Give concrete,
  actionable fix items so the implement stage can act without guessing.
- **surface** — you and the implementation cannot converge (e.g. the fix
  round did not resolve the defect, or the plan itself is wrong). Stop
  the run with a clear summary of the disagreement for a human.

End with exactly one routing JSON object:

```json
{"preferred_next_label":"Ready","context_updates":{"verdict":"ready"}}
```

or:

```json
{"preferred_next_label":"Fix","context_updates":{"verdict":"fix"}}
```

or:

```json
{"preferred_next_label":"Surface","outcome":"failed","failure_reason":"<one-line summary of the disagreement>","context_updates":{"verdict":"surface"}}
```
