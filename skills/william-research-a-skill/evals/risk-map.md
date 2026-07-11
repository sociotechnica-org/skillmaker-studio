---
bundle: william-research-a-skill
---
<!-- The authored coverage axis ONLY (data-model.md §2.6) -- no results
     column, ever: validation is computed from graded runs and joined in the
     viewer at read time. Risk ids band into IN (input) / RE (reasoning) /
     OUT (output) / ADV (adversarial) / CHN (chain) families. Coverage is
     ● covered / ◐ partial / ○ gap (or the plain words). Fixture is the
     evals/fixtures/<case>/ directory name that buys this row's coverage, or
     "—" for a gap. -->

| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | bundle.json's oneLiner and design.md's Intent are both empty, and the agent invents a topic and researches it anyway instead of stopping (design.md failure hypothesis #1) | ○ gap (ungraded, see honest gaps) | golden-basic (positive, ungraded); refusal-empty-topic (negative, not yet authored) |
| IN-2 | Revise notes from a prior review are silently ignored in favor of re-researching from scratch (design.md failure hypothesis #2) | ○ gap | — |
| OUT-1 | A stated-but-unconfident fact is written into research/notes.md as if it were settled, with no hedge or open-question flag (design.md failure hypothesis #3) | ○ gap | — |
| OUT-2 | The agent edits files outside research/ (design.md failure hypothesis #4) | ○ gap | — |
| RE-1 | research/notes.md restates the topic and platitudes with no concrete, checkable facts or edge cases (design.md failure hypothesis #5) | ○ gap (ungraded, see honest gaps) | golden-basic (ungraded) |

## Honest gaps

- **`golden-basic` is authored and its content is genuinely good, but no
  run of it has ever reached a gradeable state.** Three real
  `skillmaker run william-research-a-skill --fixture golden-basic
  --provider claude-code` attempts against this design (run ids
  `e53a2ca1-...`, `6a0f37ec-...`, `791a4742-...`) all ended
  `status: "infra-error"`. `skillmaker grade` refuses to grade any run
  whose status isn't `"completed"` by design (`Grade.ts`: "infra-error/
  running runs are never graded") -- correctly so, since a dropped
  connection carries no task-level verdict -- so none of these three runs
  could be graded, and every risk row this fixture would buy stays `gap`
  rather than `covered`/`partial` until a clean run exists.
  - The first attempt (`e53a2ca1-...`) is the interesting one: its
    transcript actually shows a normal completion --
    `{"result":{"stopReason":"end_turn"}}` on the outer `session/prompt`
    request (JSON-RPC id 3) -- and its artifacts include a real, well-
    formed `research/notes.md` (Keep a Changelog vs. Common Changelog
    conventions, a "must handle"/"must never" edge-case list, five named
    open questions) that would very plausibly pass `golden-basic`'s
    answer key. The CLI still reported `infra-error`. The other two
    attempts (`6a0f37ec-...`, `791a4742-...`) genuinely never received a
    final response after roughly a dozen auto-approved permission
    requests each -- the adapter connection went quiet mid-session with
    no explicit error on stderr beyond routine hook-not-found notices.
  - Working theory, not confirmed: `AcpClient`'s own outgoing JSON-RPC id
    counter (`initialize`=1, `session/new`=2, `session/prompt`=3) is a
    *separate* namespace from the agent's own ids for the
    `session/request_permission` calls it sends back to us -- but this
    fixture's prompt triggers roughly a dozen permission requests
    (WebFetch/WebSearch calls per source), and the agent's own id counter
    for those requests reaches into the same low integer range (0-12)
    as our outstanding `session/prompt` id (3). Whether that's a genuine
    id collision inside `AcpClient`'s single `pending` map, or a red
    herring and the real cause is a connection reliability issue in the
    `@zed-industries/claude-code-acp` adapter under this many permission
    round-trips, was not conclusively determined in this pass.
  - Not fixed here: this is a `RunEngine`/`AcpClient` core-engine
    classification/reliability question, not a `william-research-a-skill`
    skill-text issue, so it is out of scope for "if it fails, revise the
    skill and re-run" (Phase 19 plan.md). Filed as a todo
    (`investigate-run-infra-error-on-heavy-permission-fixtures`) rather
    than silently re-labeled as a pass. `william-research-a-skill`
    therefore ships to `evaluating`/`published` stages later in this
    phase with an honestly ungraded golden fixture, not a green one.
- **IN-2 / OUT-1 / OUT-2 / refusal-empty-topic**: no fixtures buy these
  rows yet. This pass (Phase 19) only authored `golden-basic`. Filed as a
  todo (`fixture-add-william-research-revise-and-scope`), matching the
  honesty pattern already established for `william-draft-skill-md`'s own
  `revise-round`/scope gaps.
