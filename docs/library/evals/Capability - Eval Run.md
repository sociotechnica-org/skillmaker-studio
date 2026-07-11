---
type: Capability
prefLabel: Eval Run
context: evals
status: migrated
links:
  operates_on:
    - "./Entity - Fixture"
  produces:
    - "./Entity - Read-Out"
  related_to:
    - "./Reference - Measurement Policy"
---

## WHAT
The real run of a bundle's skill against one fixture case — direct rename:
**Dry-Run → eval run** (`Run.kind: "eval"`). `skillmaker run <slug>
--fixture <case>` boots a sandboxed workspace, installs the recorded
skill version, and drives one ACP session against the fixture's
`prompt.md`.

## WHY
The embedded-Fabro execution model (Alexandria's own factory booting the
play) has no analog in v1 — there is no Fabro at all in this product. It's
replaced by a leaner ACP-subprocess run engine: no compile step, no
workflow graph, just a temp workspace, the skill files, and one ACP
session.

## HOW
CLI: `skillmaker run <slug> --fixture <case> [--provider <id>] [--timeout
<seconds>]` (`packages/cli/src/commands/Run.ts`). Exit codes are
deliberately distinct so scripts can separate infra faults from real task
failures: `0` completed, `1` failed, `2` usage, `3` infra-error.

Mechanics, driven by `runFixture` in `packages/core/src/RunEngine.ts`
(data-model.md §2.8): create a temp sandbox workspace → copy the fixture's
`setup.files` in → install `output/` as the skill → launch the configured
provider over ACP with the fixture's `prompt.md` → capture the transcript
→ diff the workspace into `artifacts/`. `run.json` is written at start,
finalized at end, then immutable; `run.started`/`run.completed` land on the
journal. The engine keeps `infra-error` (auth/sandbox/connection faults)
strictly apart from `failed` (a genuine task failure) so infra noise never
pollutes a Pass Rate.

An Eval Run operates on an [[Entity - Fixture]] (consuming its
`prompt.md`, not `expected/`) and produces the raw material for an
[[Entity - Read-Out]] once graded.

Verified: `packages/cli/src/commands/Run.ts` (`runRun`, the exact `--fixture
<case> [--provider <id>] [--timeout <seconds>]` flag shape, the four exit
codes via `ok`/`expectedFailure`/`infraError`/`usageError`) and
`packages/core/src/RunEngine.ts` (`runFixture`'s sandbox → ACP → artifact
pipeline, the infra-error/failed split).
