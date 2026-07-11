# Anthropic skill-creator — competitive teardown (2026-07-11)

> Research for Skillmaker Studio. Primary sources: the installed plugin on
> disk plus a live headless run. Every file path cited is real and was read
> in full. Unverified claims are marked **[unverified]**.

Plugin location (both copies byte-identical):

- Marketplace checkout: `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/`
- Cache (what a session actually loads): `~/.claude/plugins/cache/claude-plugins-official/skill-creator/2f634a9314e6/`

All paths below abbreviate the marketplace copy as `<plugin>`.

---

## 1. What it is

Anthropic's official skill-authoring skill, shipped in the
`claude-plugins-official` marketplace. One plugin, one skill
(`skill-creator:skill-creator`), no hooks, no MCP servers, no commands —
the entire product is a 485-line `SKILL.md` playbook plus ~3,200 lines of
supporting Python and HTML. It covers the full lifecycle: intent capture →
SKILL.md drafting → test-prompt evals with with/without-skill baselines →
human review in a browser viewer → iteration → description/trigger
optimization → `.skill` packaging.

Positioning signal from the SKILL.md itself
(`<plugin>/skills/skill-creator/SKILL.md:306`): "we are trying to create
billions a year in economic value here!" — Anthropic treats skill authoring
as a first-class economic surface, not a dev convenience.

## 2. Package anatomy

```
skill-creator/
├── .claude-plugin/plugin.json      # name + description only; no version field
├── README.md, LICENSE
└── skills/skill-creator/
    ├── SKILL.md                    # 485 lines; the whole authoring playbook
    ├── agents/                     # prompts for subagents spawned BY the main session
    │   ├── grader.md               # assertion grading + eval self-critique
    │   ├── comparator.md           # blind A/B judge (rubric, 1-5 scales → 1-10)
    │   └── analyzer.md             # post-hoc "why did the winner win" + benchmark pattern analysis
    ├── references/
    │   └── schemas.md              # canonical JSON schemas: evals.json, grading.json,
    │                               #   metrics.json, timing.json, benchmark.json,
    │                               #   comparison.json, analysis.json, history.json
    ├── eval-viewer/
    │   ├── generate_review.py      # 472 lines; discovers runs, embeds data, serves/writes HTML
    │   └── viewer.html             # 1,325-line template; Outputs + Benchmark tabs
    ├── assets/
    │   └── eval_review.html        # separate template: trigger-eval set editor (toggle/edit/export)
    └── scripts/
        ├── quick_validate.py       # frontmatter lint (kebab-case name ≤64, description ≤1024, no <>)
        ├── package_skill.py        # validates then zips to <name>.skill; excludes evals/ at root
        ├── run_eval.py             # trigger eval: does the description make Claude invoke the skill?
        ├── run_loop.py             # trigger-optimization loop (train/test split, up to 5 iterations)
        ├── improve_description.py  # calls `claude -p` to propose better descriptions
        ├── aggregate_benchmark.py  # folds grading.json files into benchmark.json/.md stats
        ├── generate_report.py      # HTML report for the description-optimization loop
        └── utils.py                # SKILL.md frontmatter parser
```

Notable roles:

- **`agents/*.md` are prompt documents, not registered agents.** The main
  session reads them and spawns generic subagents with those instructions.
- **`references/schemas.md` is load-bearing**: the viewer reads exact field
  names (`configuration` not `config`; grading expectations must be
  `text`/`passed`/`evidence`) and the SKILL.md warns twice that deviating
  breaks the viewer.
- **The eval harness for *behavior* is not a script at all** — it is prose
  in SKILL.md instructing the orchestrating Claude to spawn subagents.
  Only the *trigger* eval (`run_eval.py`) and aggregation are code.

## 3. The authoring loop (turn-by-turn behavior)

From `<plugin>/skills/skill-creator/SKILL.md`:

1. **Capture intent** — 4 fixed questions (what it enables, when it
   triggers, output format, whether test cases make sense). If the current
   conversation already contains the workflow ("turn this into a skill"),
   extract from history first.
2. **Interview + research** — edge cases, formats, dependencies; use MCPs
   and parallel subagents for research if available.
3. **Write SKILL.md** — with explicit doctrine: descriptions should be
   deliberately "pushy" because Claude "undertriggers" skills; explain the
   *why* instead of ALL-CAPS MUSTs ("If you find yourself writing ALWAYS or
   NEVER in all caps ... that's a yellow flag"); progressive disclosure
   (metadata → <500-line body → bundled resources); organize multi-domain
   skills as `references/<variant>.md`.
4. **Test cases** — 2-3 realistic prompts saved to `evals/evals.json`
   (prompts only; assertions drafted later, *while runs execute* — the loop
   is explicitly pipelined).
5. **Run** — for each case, spawn **with-skill and baseline subagents in
   the same turn**. Baseline = no skill (new skill) or a pre-edit snapshot
   (improving). Results in `<skill>-workspace/iteration-N/eval-<name>/`.
6. **Capture timing** — from subagent completion notifications
   (`total_tokens`, `duration_ms`) → `timing.json`; SKILL.md notes this is
   "the only opportunity" to capture it.
7. **Grade → aggregate → analyze → launch viewer** (§4/§5 below).
8. **Read feedback** from `feedback.json`; empty feedback = fine; improve,
   snapshot, rerun into `iteration-N+1/`, repeat until user is happy.
9. **Description optimization** — a fully automated loop (§4c).
10. **Package** — `package_skill.py` → `.skill` zip.

**Personas:** SKILL.md:34 explicitly targets "plumbers opening their
terminals, parents and grandparents googling 'how to install npm'" —
communication guidance says "evaluation"/"benchmark" are borderline-OK
words, "JSON"/"assertion" need cues before using unexplained. There are
dedicated adaptation sections for **Claude.ai** (no subagents → run tests
inline, skip benchmarking, skip trigger optimization) and **Cowork**
(subagents yes, browser no → `--static` viewer; includes an all-caps plea:
"GENERATE THE EVAL VIEWER *BEFORE* evaluating inputs yourself").

## 4. The eval system

Three distinct measurement layers:

### a) Behavioral evals (subagent-run, LLM-graded)

- **Definition:** `evals/evals.json` inside the skill dir
  (`references/schemas.md:7-35`): `{id, prompt, expected_output, files[],
  expectations[]}` — expectations are natural-language verifiable
  statements, not code assertions. Per-run `eval_metadata.json` mirrors the
  prompt + assertions into the workspace.
- **Execution:** no harness code. The orchestrating Claude spawns Task
  subagents (with-skill and baseline) per prompt, saving to
  `<workspace>/iteration-N/eval-<name>/{with_skill,without_skill|old_skill}/outputs/`.
- **Grading:** a subagent reads `agents/grader.md`. Beyond pass/fail with
  quoted evidence, the grader also (i) extracts and verifies *implicit
  claims* from outputs (factual/process/quality), (ii) reads executor
  `user_notes.md` for flagged uncertainties, and (iii) **critiques the
  evals themselves** — flagging non-discriminating assertions ("a
  hallucinated document would also pass") in an `eval_feedback` block.
  Burden of proof is on the expectation; no partial credit.
- **Metrics measured:** pass rate (per assertion and aggregate), wall time,
  tokens (from task notifications; falls back to `output_chars` as a token
  proxy in `aggregate_benchmark.py:152-153`), tool-call counts, error
  counts.
- **Aggregation:** `scripts/aggregate_benchmark.py` walks
  `eval-*/<config>/run-*/grading.json`, computes mean/stddev/min/max per
  config plus a delta row, and emits `benchmark.json` + `benchmark.md`.
  Statistical honesty is n≥2 stddev — no CI, no binomial anything.
- **Persistence:** everything is loose JSON in the per-iteration workspace
  (a *sibling* of the skill dir, excluded from packaging). `history.json`
  tracks version progression (v0/v1/v2, parent, pass rate, won/lost) —
  version identity is just a label, **not a content hash**.

### b) Blind comparison (optional)

`agents/comparator.md`: two outputs labeled A/B, judge doesn't know which
skill produced which; generates a task-specific rubric (content + structure
criteria, 1-5 each → overall 1-10), assertions are secondary evidence, ties
discouraged. Then `agents/analyzer.md` "unblinds": reads both skills and
transcripts, scores instruction-following 1-10, and emits prioritized
improvement suggestions in fixed categories (instructions/tools/examples/
error_handling/structure/references). SKILL.md calls this optional: "the
human review loop is usually sufficient."

### c) Trigger evals (fully coded, the most engineered part)

`scripts/run_eval.py` answers a different question: *does the description
make Claude consult the skill at all?*

- Eval set: 20 realistic queries, `{query, should_trigger}` — with explicit
  craft guidance (typos, file paths, backstory; negative cases must be
  *near-misses*, not obviously irrelevant).
- Mechanism (`run_eval.py:35-181`): writes a temp command file into
  `.claude/commands/` so the skill appears in `available_skills`, runs
  `claude -p <query> --output-format stream-json --include-partial-messages`
  as a subprocess (stripping `CLAUDECODE` from env to allow nesting), and
  watches the stream for a `Skill`/`Read` tool_use whose partial JSON
  mentions the temp skill name — early-exiting the moment triggering is
  detectable. 10 parallel workers, 3 runs per query, trigger threshold 0.5.
- `scripts/run_loop.py` wraps it: stratified 60/40 train/test split,
  evaluates, calls `claude -p` (`improve_description.py`) to propose a
  better description from the failures, re-evaluates, up to 5 iterations,
  **selects best by held-out test score** to avoid overfitting; live HTML
  report via `generate_report.py` (auto-refresh meta tag).
- The user reviews/edits the query set first in `assets/eval_review.html` —
  an editable table with should-trigger toggles that exports
  `eval_set.json` via browser download.

## 5. HTML eval viewer mechanics

Code: `<plugin>/skills/skill-creator/eval-viewer/generate_review.py` (472
lines) + `eval-viewer/viewer.html` (1,325-line template). Stdlib-only, no
dependencies.

- **Discovery:** `find_runs()` recursively finds any directory containing
  `outputs/`; prompt comes from `eval_metadata.json` (or regex-scraped from
  `transcript.md`); `grading.json` is picked up from the run dir or its
  parent.
- **Embedding:** every output file is inlined into one self-contained HTML
  page — text extensions as escaped text, images/PDFs as base64 data URIs,
  `.xlsx` specially typed (rendered client-side, `renderXlsx()` at
  viewer.html:830), everything else as a base64 download link. The template
  has a `/*__EMBEDDED_DATA__*/` placeholder replaced by a
  `const EMBEDDED_DATA = {...}` blob.
- **Serving:** a tiny stdlib `HTTPServer` on `127.0.0.1:3117` (kills
  whatever holds the port first, via `lsof`; falls back to an ephemeral
  port). `GET /` **regenerates the HTML on every request** — refreshing the
  browser picks up newly finished runs without restarting. `GET/POST
  /api/feedback` reads/writes `feedback.json` in the workspace. Launched
  with `webbrowser.open(url)`; SKILL.md tells the model to `nohup ... &`
  it and `kill $VIEWER_PID` after feedback is read.
- **Headless mode:** `--static <path>` writes the standalone HTML instead;
  the Submit button then *downloads* `feedback.json` for the model to
  retrieve (the Cowork path).
- **What it displays:** two tabs.
  - *Outputs* — one test case at a time: prompt, rendered outputs,
    collapsible Previous Output (via `--previous-workspace`), collapsible
    Formal Grades (pass/fail + evidence), an auto-saving feedback textarea,
    previous-iteration feedback below it. Arrow-key navigation; "Submit All
    Reviews" finalizes `feedback.json` with `status: "complete"`.
  - *Benchmark* — reads `benchmark.json` (`--benchmark` flag): per-config
    pass-rate/time/token cards with mean ± stddev, delta coloring,
    per-eval breakdowns grouped by `eval_name` and `configuration`
    (`with_skill`/`without_skill` are hardcoded for color coding), and the
    analyzer's freeform notes.
- **The feedback loop is the point:** the viewer is not a dashboard; it is
  a *feedback collection instrument* whose output (`feedback.json`) is the
  input to the next improvement iteration. Empty feedback on a case is
  read as approval.

## 6. Live-run observations (what I actually saw vs read)

Method: headless `claude -p` (v2.1.207) in a scratch dir,
`--permission-mode acceptEdits`, prompting the skill to create a tiny
`word-counter` skill with one eval, one with-skill run, grading, benchmark,
and a `--static` viewer. Total ~11 minutes.

**Observed (real artifacts, verified on disk):**

- The skill produced exactly the documented shapes: `word-counter/SKILL.md`
  (with a properly "pushy" description), `word-counter/evals/evals.json`,
  workspace `word-counter-workspace/iteration-1/eval-0-basic-count/` with
  `eval_metadata.json`, `inputs/sample.txt` (a deliberate 25-word fixture),
  `with_skill/outputs/word_count.txt`, `with_skill/timing.json`
  (13,218 tokens, 24.4s — captured from the subagent notification as
  documented), and `with_skill/grading.json` with per-assertion evidence
  (the grader independently re-verified ground truth with `wc -w`).
- The eval ran as a real subagent and passed 2/2 assertions.

**Observed friction (honest caveats):**

- **Permissions:** in the non-interactive session, the inner Claude was
  blocked from reading the plugin directory and from running `python3`, so
  it *hand-wrote* `benchmark.json` and `review.html` matching the schemas
  instead of executing the real scripts, and said so explicitly. Headless
  acceptEdits is not enough for the full pipeline; interactive sessions
  prompt for approval instead. So the *end-to-end scripted* path is
  verified partly by me running the scripts directly (next bullet), not by
  the agent's own run.
- **I then ran the real scripts myself** against the agent's workspace:
  `generate_review.py --static` worked perfectly — produced a 46KB
  self-contained `review-real.html` with the output, grading, and benchmark
  embedded. But `aggregate_benchmark.py` produced an **empty benchmark**
  (`"runs": []`): it requires the layout
  `eval-*/<config>/run-*/grading.json` (`aggregate_benchmark.py:101-117`),
  while the SKILL.md workflow instructs subagents to write to
  `eval-<name>/<config>/outputs/` with `grading.json` beside it — no
  `run-*` level. Also the grader's real-world `grading.json` had
  `"summary": "<string>"` where the aggregator expects
  `summary.pass_rate` (`aggregate_benchmark.py:130`). **There is live
  schema/layout drift between the prose workflow and the aggregation
  script**; the SKILL.md papers over it by allowing manual benchmark.json
  generation ("If generating benchmark.json manually, see
  references/schemas.md"). LLM-orchestrated glue absorbs the drift; coded
  pipelines would not.
- The viewer did not auto-open a browser in either case (expected —
  `--static` was used; server mode calls `webbrowser.open`, not observed
  live **[unverified in server mode]**).

## 7. Comparison: skill-creator vs Skillmaker Studio

Skillmaker references: `docs/plans/2026-07-10-playmaker-to-skillmaker-migration/data-model.md` §2.5-2.12.

| Concept | skill-creator | Skillmaker Studio |
|---|---|---|
| Unit of work | The skill directory itself; workspace is a disposable sibling | Skill Bundle; SKILL.md is one *output* of the bundle (§1.0) |
| Eval definition | `evals/evals.json`: prompt + NL `expectations[]` | `evals/fixtures/<case>/case.json`: prompt + class (golden/refusal/empty/rerun/hard-case) + `risks[]` + answer key + grading checks (§2.5) |
| Coverage model | None — evals are a flat list | `risk-map.md`: risk families (IN/RE/OUT/ADV/CHN), coverage ● ◐ ○ per fixture; coverage ⊥ validation (§2.6, law §1.4) |
| Run identity | `iteration-N/eval-<name>/<config>/run-N/` directories; version = "v0/v1" label in `history.json` | ULID run = fixture × **content-hash version** × provider × model; immutable `run.json` (§2.7-2.8) |
| Grading | LLM grader subagent writes `grading.json` (file); pass/fail + evidence + claim verification + eval self-critique | Human-in-viewer verdict → `run.graded` **journal event**; regrades append-only (§2.9); ruling E |
| Measurement | mean ± stddev pass rate/time/tokens per config; with vs without-skill delta | n · pass-rate · CI per (version, provider, model), never pooled; SQL `measurements` view (§2.11, laws §1.5-1.6) |
| Baseline concept | **with-skill vs without-skill (or old-skill) delta** — its signature stat | None — measures skill against fixtures, not against absence of skill |
| Trigger testing | `run_eval.py`/`run_loop.py`: automated trigger-rate optimization with train/test split | Not present (design.md "When to use / triggers" seeds the description; no measurement) |
| Review surface | Ephemeral localhost viewer / static HTML; feedback.json → next iteration | Read-out: a viewer surface joining risk-map × measurements × transcripts, grading panel emits journal events (§2.12) |
| Provenance | None — no actor, no event history; timing data is lost unless captured in the moment | Actor on every mutating record; journal is canonical shared history (laws §1.7, §2.9) |
| Infra failures | `errors_encountered` count only; infra vs skill failure not split | `infra-error` vs `failed` status keeps pass rates clean (§2.8) |
| Publish | `package_skill.py` → `.skill` zip; validation = frontmatter lint only | Guarded publish gate (`bundle.gate_decided`) on top of stage machine; `skill.published` event with version hash |
| Brownfield | Can "improve an existing skill" (snapshot as baseline) but adopts nothing durable | `skillmaker adopt` — idempotent adopt of existing repos is the planned front door (strategy doc §3B) |
| Personas | Novice-friendly single user, chat-first | Studio/agent-first (William + stations), director-gated production |

**Their unique strengths (things we don't have):**

1. **The without-skill baseline delta** — "does this skill beat vanilla
   Claude, by how much, at what token/time cost" is the single most
   persuasive number in the whole product, and we have no equivalent.
2. **Trigger-rate evals as code** — measuring and *optimizing* the
   description against realistic should/shouldn't-trigger queries with a
   held-out test set. Nobody else has this either (their stream-JSON
   early-exit detection is genuinely clever).
3. **Grader self-critique** — the grader flags non-discriminating
   assertions and coverage gaps as a standing output (`eval_feedback`).
4. **Zero-dependency, feedback-first viewer** — regenerate-on-refresh,
   auto-saving per-case feedback that closes the loop into the next
   iteration, previous-iteration outputs/feedback shown side by side.
5. **Pipelined UX** — draft assertions while runs execute; spawn all runs
   in one turn; capture timing from notifications.

**Our unique strengths (things they lack):**

- Content-hash **version pinning** — their measurements bind to nothing;
  ours bind to version × provider × model.
- **Guarded publish** — their packaging is a zip with a lint; ours is a
  gate decision with evidence, on a journal.
- **Journal provenance** — their history is loose files that the SKILL.md
  admits can be lost ("this is the only opportunity to capture this data");
  ours is append-only shared history with actors and idempotency.
- **Risk-map coverage** as a first-class axis, separate from validation.
- **Brownfield adopt** and durable bundles (research + design + fixtures
  survive; their workspace is scaffolding to throw away).
- **Statistical honesty** — n/CI, never pooled, infra-error segregation;
  their stddev-over-3-runs conflates everything and uses `output_chars` as
  a token proxy when notifications are missed.

## 8. Strategic implications

- **Fold in: without-skill baseline runs.** (Director pre-authorized
  obvious fold-ins.) Add a run kind or fixture-level flag for
  baseline (no-skill) runs and show the delta in the read-out and skillbook
  receipts. It costs one extra run per fixture and produces the single most
  marketable number a skill can have — and it composes perfectly with our
  version × provider × model measurement key (baseline = null version).
- **Fold in: trigger-rate measurement.** A `triggers.json` eval set per
  bundle (should/shouldn't-trigger queries) run via the same ACP/headless
  machinery, graded automatically, journaled like any run. Their
  train/test-split *optimizer* is a later luxury; the *measurement* is
  cheap and fills a real gap — our design.md seeds the description but
  nothing verifies it. Their `.claude/commands/` + stream-JSON early-exit
  trick (run_eval.py:51-96) is directly reusable.
- **Fold in: grader self-critique of evals.** Add an "eval feedback" field
  to the grading panel / station-agent grading prompt: flag
  non-discriminating checks and uncovered outcomes. This is prompt-level
  work, near-zero cost, and feeds the risk-map (a flagged gap is a new ○
  row).
- **Do NOT copy their persistence.** The live run demonstrated the failure
  mode of prose-orchestrated pipelines: layout/schema drift between
  SKILL.md, grader.md, and aggregate_benchmark.py, absorbed silently by
  the LLM hand-writing the benchmark file. Our files+journal+reindex model
  with schemas validated at append is the differentiated answer — lean
  into "measurements you can trust" as the positioning wedge. Their own
  docs concede timing data "cannot be recovered after the fact."
- **Match their review-loop ergonomics in the read-out.** Per-case
  free-text feedback that becomes the agent's next instruction (we already
  have `review.resolved: revise` notes — surface a per-fixture feedback
  box in the read-out grading panel that rolls up into one revise note),
  previous-iteration output shown beside current, and keyboard-driven
  case-to-case navigation. Their viewer proves a human will grade a whole
  iteration in one sitting if the surface makes it pleasant.

---

*Live-run artifacts (scratch, not committed):*
`/private/tmp/claude-501/-Users-jessmartin-Documents-code-alexandria-internal/2d5790f8-e846-4296-bea6-d9cf24caff56/scratchpad/skill-creator-live-run/`
