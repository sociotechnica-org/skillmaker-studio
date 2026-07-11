# Phase 20 — Story 2 Friction Log: Porting a Model-Tuned Skill

Persona: staff engineer porting a months-tuned `pr-description` skill to a
new default model, needing measured proof the port is at least as good.
Environment: macOS arm64, binary install `0.1.0+0df50e0`, workspace
`~/Documents/code/sm-story2-port`, provider `claude-code` via
`@zed-industries/claude-code-acp`.

Severity: P1 = blocks/undermines the story's core job; P2 = real friction,
workaround exists; P3 = polish. Numbered in the order hit.

## Findings

### F1 (P1) — No way to choose, pin, or even know the model

The whole story is "prove the port to a new model," and the product cannot
target a model at all:

- `skillmaker run` has no `--model` flag; docs never mention model
  selection anywhere.
- `skillmaker.config.json` providers carry only a `command` array. I
  wrapped it with `env ANTHROPIC_MODEL=...` — silently ignored. Proof: a
  provider pinned to `ANTHROPIC_MODEL=totally-bogus-model-xyz` **completed
  successfully** (run `78ea3b97`), so the variable never reached anything
  that cared.
- The ACP adapter itself advertises model selection — the transcript's
  `session/new` response lists `availableModels` (`default` = Opus 4.6,
  `sonnet`, `haiku`) — but skillmaker never exposes `setSessionModel`; it
  always runs `currentModelId: "default"`.

Meanwhile the measurements docs show cells like `claude-code/fake-model-1`
and promise per-model isolation — a schema the user has no way to populate
with a second model. Time spent confirming the absence: ~15 minutes plus a
burned eval run. **Proposal:** `run --model <id>` mapped to ACP
`setSessionModel`, or a `providers.<id>.model` config field; document it on
the run page.

### F2 (P1) — Model identity recorded as the alias "default", not the resolved model

`run.json` and the measurements PROVIDER column say `claude-code/default`.
Which model is that? I only learned "Opus 4.6" by hand-grepping
`transcript.jsonl` for `availableModels`. Worse: "default" resolves to
whatever the user's Claude Code account default is *that day*. If Anthropic
or the user changes the default mid-project, new runs land in the **same
measurement cell as a different real model**, silently breaking the
product's own "never pooled" guarantee — the exact corruption this
persona's comparison cannot afford. **Proposal:** resolve and record the
concrete model id at session start (it is already in the transcript);
treat `default` as an input, never as the stored identity.

### F3 (P2) — Released binary and docs disagree in both directions

- docs CLI Reference: "No published package exists yet — users must
  install from source," yet the marketing one-liner installed a working
  binary.
- The same reference lists `adopt`, `publish`, and `book build`; the
  installed binary has none of them (checked `--help`). Known issue class
  from other testers; did not block this story, but a fresh user cannot
  tell which surface to trust. **Proposal:** generate the CLI reference
  from the released binary's help, stamped with the version.

### F4 (P2) — Fixture class selection is undiscoverable and the default fights the name

`fixture add` accepts `--class` (docs list six classes) but the flag
appears in neither the docs' command syntax nor `skillmaker --help`; I
found it via the usage error from `skillmaker fixture --help` (which
itself exits 1 with `unknown "fixture" subcommand "--help"`). And a case
literally named `hard-case-terse-diff` still scaffolds `"class": "golden"`.
I hand-edited `case.json`. **Proposal:** document `--class`, support
`fixture add --help`, and warn when the case name starts with a known
class that contradicts the chosen one.

### F5 (P2) — `partial` verdicts vanish into PASS%

Grading offers `pass|fail|partial`, and my three baseline hard-case runs
were textbook partials (structure and coverage right, hedging rule
violated). `measurements` renders them as `0%` with no partial column —
indistinguishable from three catastrophic failures. Nothing in the docs
says how partial is counted; I had to infer "partial = not pass" from the
table. For a port comparison, "3 near-misses vs 3 disasters" is the whole
story. **Proposal:** show pass/partial/fail counts in the cell (or a
PARTIAL% column) and document the pass-rate rule on the grade page.

### F6 (P2) — Version labels don't surface where versions are compared

I labeled versions `v1-legacy-scaffolding` and `v2-ported-lean`, but the
measurements table shows only `sha256:6a20a659ff75` / `sha256:37cbdbdf6518`.
The one table whose job is version-vs-version comparison makes me keep a
hash→label glossary in my head (labels do show in `status`, one command
away). **Proposal:** print the label next to (or instead of) the short
hash in measurements; include both in `--json`. (The viewer API's
`versions` array does expose labels, so the data is there to join.)

### F7 (P3) — Scaffold ignores `--name` casing in design.md

`new pr-description --name "PR Description"` set the bundle name
correctly, but `design.md` was generated with the title-cased-slug heading
"Design — Pr Description". Cosmetic.

### F8 (P3) — `--json` run output is not clean JSON on stdout

`skillmaker run ... --json` still interleaves progress lines
("sandbox ready...", dots) with the JSON document. They appear to go to
stderr — piping worked — but the run page doesn't say so, and a fresh user
scripting k=3 loops has to discover it by trying. **Proposal:** document
the stdout/stderr contract on the run page.

## Delights

- Install one-liner did exactly what the site promised, told me the
  version and PATH line, ~10 seconds.
- `run` UX is excellent: sandboxed workspace, fixture files staged,
  permission auto-approved with a visible note, artifact list and run dir
  printed at the end. Six runs, zero babysitting, ~30 s each.
- The fixture layout (`prompt.md` prose vs `case.json` classification vs
  `expected/answer-key.md` kept out of the agent workspace) matches how a
  careful eval author already thinks.
- Grading as an append-only journal event ("a decision, not a stored
  field") with latest-wins regrade is the right call and clearly stated.
- Measurement cells never pooling across version/provider is exactly the
  isolation a port comparison needs (F2 notwithstanding).
- No usage limits were hit during ~14 eval runs.

## Measurements (final)

| Version | Fixture | Provider/model | n | Pass | Verdicts |
| ------- | ------- | -------------- | - | ---- | -------- |
| v1-legacy-scaffolding (`6a20a659ff75`) | golden-basic | claude-code/default (Opus 4.6 per transcript) | 3 | 100% | 3 pass |
| v1-legacy-scaffolding | hard-case-terse-diff | claude-code/default | 3 | 0% | 3 partial (unhedged motivation claims) |
| v2-ported-lean (`37cbdbdf6518`) | golden-basic | claude-code/default | 3 | 100% | 3 pass |
| v2-ported-lean | hard-case-terse-diff | claude-code/default | 3 | 100% | 3 pass |

Port verdict: v2 is at least as good on both fixtures at n=3 (below the
product's own "smoke" threshold of 5 — the GUIDANCE column correctly
refused to bless it). The product *did* put both versions' rows in one
table; what I still assembled by hand: hash→label mapping, the
partial-vs-fail distinction, and the model identity.

## Notes

- Model-switch budget: ~15 min of the allotted 20 (docs sweep, env
  wrapper, negative test with a bogus model, adapter `--help`).
- The port was therefore **simulated**: v2 rewrote the skill for a
  hypothetical newer model (scaffolding trimmed, evidence-discipline
  hedging rule added, triggers tightened) and both versions were measured
  on the same `claude-code/default` provider.
