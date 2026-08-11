# Eval ecosystem survey (2026-08-11)

Research compiled for the eval-writer / eval-datamodel design conversation
(director + Raven, 2026-08-11). Two deep dives (smevals, upskill — clones
were made at /tmp/smevals-dive and /tmp/upskill-dive) plus a web-search
landscape pass. Findings inform the `skill.json` datamodel and runner-
contract design; see the design doc that follows this survey.

## Headline conclusions

1. **The failure-hypothesis / proof-spec layer is verified white space.**
   No surveyed tool has a design-time object saying "this is a way the
   skill could fail, and this is what would prove it," with cases linked
   back to it. Everyone else's chain starts at the dataset; ours starts at
   design. Closest (and still wrong-shaped): promptfoo's red-team harm
   categories (generic, config-time), smevals' tags (observed at grade
   time, not authored), Braintrust's informal one-scorer-per-hypothesis
   convention.
2. **Also distinctively ours:** never-pooled measurement cells keyed
   (bundle, fixture case, skill versionHash, provider, model) with
   Wilson / rule-of-three CIs (nobody keys cells on subject-version hash;
   nobody states a never-pool discipline), and git-native append-only
   human grade records (human grading elsewhere is always platform UI
   state).
3. **The bigger differentiation claim (director, 2026-08-11): the full
   enterprise skill lifecycle.** Every surveyed tool evaluates models or
   prompts; none has a lifecycle where evals are one station among
   design → draft → eval → publish → drift → improve with human judgment
   at the gates. The failure-hypothesis layer is the *evidence* of the
   lifecycle: evals born from design, not bolted on.
4. **Rails analogy (director):** Rails shipped with sqlite so you could
   start instantly, and ActiveRecord owned the schema so Postgres later
   was a dialect swap. SMS already ships its sqlite — the ACP RunEngine
   is the bundled default runner. What's missing is the ActiveRecord: a
   skill-lifecycle schema SMS owns (`skill.json`), with execution infra
   as adapters behind a runner contract. Braintrust integration is
   post-launch; the only pre-launch alignment worth making is free field
   naming (`expected`).

## smevals (prime-radiant-inc/smevals)

Simon Willison's file-native eval framework. July 2026, v0.2.0, ~1,100
lines of Python (click + pyyaml), MIT, explicitly experimental. 242★ / 8
forks in ~3 weeks, 2 contributors (Willison ×39 commits, Jesse Vincent
×1), 88 tests, README doubles as the spec.

**Vocabulary** (the best-articulated in the field): **Suite ⊃ Eval ⊃
Tasks**; a **Config** (model + runner + settings) applied to a Task via a
**Runner** (any CLI executable) produces an immutable **Run**; a
**Grader** (ordered **Checks**, each naming a **Checker**) applied to a
Run produces a **Grade**. A **Failed Run** (non-zero runner exit) is "a
harness-level error… not evidence about the model" — kept on disk, never
graded, excluded from reports (the same infra-error/failed split SMS
enforces).

**On-disk:** an Eval is any directory containing `eval.yaml`; `tasks/*.yaml`
(name + prompt; extra keys become env vars), `configs/*.yaml`,
`graders/*.yaml`, custom checker executables, and
`runs/<task>/<config>/<model-slug>/<timestamp>/` holding `run.yaml`,
`output.txt`, artifacts, and `grades/<grader>/` (grade.yaml + a
byte-for-byte grader snapshot for staleness detection). All coupling is
env vars: Runner contract (`SMEVALS_MODEL`, `SMEVALS_PROMPT`,
`SMEVALS_TASK_<KEY>`, `SMEVALS_RUN_DIR`; stdout → output.txt; exit-code
semantics) and Checker contract (`SMEVALS_RUN_DIR`, `SMEVALS_CHECK` JSON;
exit 0 = pass; optional stdout JSON `{score, metrics, tags, notes}`).
Checks in a grader share a working dir pipeline-style (`creates:`
promises) — see the pelican example's extract → validate → render →
vision-judge chain.

**Worth adopting regardless of whether we ever run its CLI:**
- The vocabulary (Run/Runner/Grade/Grader/Check/Checker/Config, Eval as
  the top-level noun, Suite for collections).
- Re-gradability: Grades as cheap recomputable views over immutable
  Runs; multiple graders per run side-by-side; `--regrade`.
- Failed-run ≠ failing-run.
- `-n` top-up/resume semantics (run until each cell has n — exactly the
  measurement-threshold need).

**As SMS's runner: too new** (director + Raven concur). No sandbox, no
`setup{files,env}` materialization, no versionHash dimension in the run
key, no human grading, sequential-only. The contract was explicitly
designed for agent-harness runners though, so staying contract-compatible
keeps the door open.

## upskill (huggingface/upskill)

HF's skill generator + evaluator. Jan 2026 launch, ~6.4k LOC Python,
Apache-2.0, 724★ / 90 forks, 2 real contributors (Shaun Smith of
fast-agent, Ben Burtenshaw of HF), PyPI 0.2.1, **dormant since
2026-05-26**. Launch-spike side project, not a maintained platform.

**Framing:** teacher/student — an expensive model (Opus/Sonnet) generates
SKILL.md bundles + synthetic tests; a cheap student model (Haiku, local
GGUF) is benchmarked with/without the skill; reports **skill lift**
(success-rate delta) and token savings, `is_beneficial` = lift > 5% or
same success with >20% token savings.

**Reality check:** despite the repo description, it never drives Claude
Code — the runner is **fast-agent** with skills injected at prompt level.
Materially weaker fidelity than real ACP sessions driving the actual
coding agent. Grading is shallow: `contains` substrings, `file_exists`,
`file_contains`, `command` (exit 0), plus an optional LLM judge. No
design phase, no human gates, no publishing, no drift, no versioning
beyond a sidecar `skill_meta.json`.

**Worth stealing:**
- `TestCase`/`VerifierSpec` schema shape — clean, minimal, filesystem-
  friendly deterministic checks.
- `.upskill/evals.yaml` scenario manifest + git-diff-scoped selection
  (changed files walked up to the nearest SKILL.md → which evals run in
  CI). Maps directly onto SMS drift/CI concepts.
- Ablation/contribution analysis (leave-one-skill-out deltas) for skill
  sets.
- The skill-lift framing as positioning vocabulary; and the existence
  proof itself — "skills need evals" now has an HF-branded blog narrative
  (+45% accuracy lifts fine-tuning open models on Claude-generated
  skills).

**Verdict: adopt-parts, not a threat.** Watch item only if HF revives it.

## Landscape (August 2026)

Headline moves: **OpenAI acquired promptfoo** (Mar 2026 — director's
read, concurred: it gets absorbed into their platform, won't remain
generic; off the board). **ClickHouse acquired Langfuse** (Jan 2026).
**OpenAI's platform Evals product shuts down 2026-11-30** — the
cautionary tale: platform-resident eval definitions die with platforms;
git-native survives. **HF lighteval added Inspect as a backend** —
Inspect is becoming shared substrate.

| Tool | Locus | Adoption | External-runner fit for sandboxed ACP agent subjects |
|---|---|---|---|
| promptfoo | File/git (YAML) | 24.1k★, OpenAI-owned | Was strong; acquisition removes it from consideration |
| **Inspect (UK AISI)** | File/git (Python) | 2.5k★ but institutional lingua franca | **Strongest**: Docker/K8s sandboxes + an agent bridge that already runs Claude Code / Codex CLI as the solver; epochs, clustered SE, `human_agent()` |
| Braintrust | Code files → SaaS | Enterprise pull | Good task flexibility; results land in their platform. Post-launch integration target |
| smevals | File/git (YAML+executables) | 242★, 3 weeks old | Contract fits; too young to depend on |
| upskill | File/git (Python CLI) | 724★, dormant | fast-agent harness = wrong fidelity; steal schemas |
| OpenAI Evals | Git registry + dying platform | legacy | Poor; platform dies Nov 2026 |
| evalite | `*.eval.ts` (Vitest) | 1.6k★ | Dev-loop tool; no sandbox/stats |
| W&B Weave | Code → platform | rides W&B | Imperative logger suits external loops; no CIs |
| LangSmith | Platform-first | LangChain gravity | Definitions live server-side; best annotation queues |
| DeepEval | pytest-style | 17.5k★ | Metrics library, not exec infra |
| Langfuse | Platform (OSS) | 32.9k★ | Score sink, not runner |
| Phoenix (Arize) | Platform (OSS) | 11k★ | Same shape as Langfuse |

Ranked as future external runners: **Inspect > (promptfoo, struck) >
Braintrust/Weave (you own the loop, they own the ledger) > sinks >
libraries**. If SMS ever outsources execution wholesale, Inspect is the
real candidate.

## Braintrust file/git story (for the post-launch integration)

Hybrid, split by plane. Logic plane is git-native: `*.eval.ts`/`.eval.py`
run by `bt eval` (`data`/`task`/`scores` triple), code scorers via
`bt functions push/pull`. Data plane is platform-first: datasets
server-versioned (`_xact_id` chains), experiments immutable on-platform,
human review as platform span state. `bt sync pull|push` moves NDJSON as
backup/migration, not source-of-truth.

Minimal round-trip bundle: `dataset.ndjson` (`input` required,
`expected`, `metadata`, `tags` per row) + eval file + scorers. Maps ~1:1
onto an SMS fixture: `prompt.md`+`files/` → `input`,
`expected/answer-key.md` → `expected`, `class`/`risks[]` →
`metadata`/`tags`. Does NOT round-trip: experiment results (re-run is the
canonical "recreate"), human-review config/provenance, dataset version
history. Pre-launch action: rename `answerKey` → `expected` (universal
field name) so the eventual exporter is trivial.

## Term-mapping recommendation

| SMS term | Recommendation | Source |
|---|---|---|
| bundle evals.json (whole artifact) | **Eval** | smevals / industry |
| failureHypothesis | **keep** — no external term exists | white space |
| proofSpec | **keep** | white space |
| fixture case | **case** (industry convergence; case.json already says it) — "fixture" stays fine for the materials dir | field |
| class (golden\|refusal\|empty\|rerun\|hard-case\|trigger) | **keep** — closed purposive taxonomy is distinctive | ours |
| grading.answerKey | **expected** | universal |
| grading.checks[] | **Check / Checker** (+ adopt smevals' env-var/exit-code/stdout-JSON contract) | smevals |
| run / run engine | **Run / Runner** (+ failed-run ≠ failing-run) | smevals |
| provider+model | **Config** | smevals |
| human grade record | **Grade**; append-only-event semantics stay as the novel part | smevals + ours |
| measurement cell | **keep "measurement"** — no external term for the keyed cell | ours |
| collection of evals | **Suite** | smevals |

## Director rulings recorded en route (2026-08-11)

- Adopt external (Braintrust/smevals-style) model for the boring layers;
  keep the white-space layers ours.
- JSON proliferation is a real problem → consolidate per-skill structure
  into one `skill.json` (the "ActiveRecord" of the skill — whole-skill
  datamodel), global settings in a `skillmaker-config.json` (naming TBD).
- Datamodel must support external runners while SMS bundles a default
  OSS runner (the existing ACP RunEngine = our "sqlite").
- Braintrust integration is post-launch.
- smevals as runner: too new. promptfoo: too heavy / acquisition risk.
- Provenance deprioritized (keep the existing harvested `source` field;
  no UI or design investment now).
- Journal-event completeness deprioritized — "getting things working >
  tracking history."
- The eval-writer skill works through CLI doors (supported by the
  unguided-baseline evidence: agents discover and honor CLI affordances).
