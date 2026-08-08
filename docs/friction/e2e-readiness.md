# E2E readiness: external users by end of week

*2026-07-29. Goal: an end-to-end working product in front of 2–3 outside
people by EOW. Entry point: https://docs.skillmaker.studio/getting-started/first-bundle/*

## What we want to learn from them

1. Install experience on a brand-new computer (bugs + confusion)
2. Roadblocks / hurdles / confusions setting up a skill
3. What first skill do they WANT to create?
4. What do they think they'd use the product for, after playing?

## The discipline

**Fix only E2E blockers. Record everything else and move on.**

Blocker test — it goes in the top list only if YES to either:
- Does it prevent completing a skill end-to-end (install → project →
  create → research → draft → eval → publish)?
- Would it make an outside user STOP (not frown — stop)?

Everything else is a papercut: logged, parked, not fixed this week.

## E2E BLOCKERS (fix now)

- [ ] **Windows `/api/projects` failure** — friend's clean-machine
  install rendered demo data (now honest-empty) because the API errored;
  root cause still undiagnosed (no error paste yet). Blocker iff any of
  the 2–3 testers are on Windows.
- [ ] **Publish step has no UI** — Publish-tab buttons disabled by design
  (flow unruled). E2E currently ends in the CLI (`skillmaker publish`).
  DECISION NEEDED: is CLI-publish acceptable for the test, or does a
  minimal honest UI door become a blocker?

- [ ] **First run lands on an empty Board — no welcome, no next action.**
  (walk, step 1). Stranger's first frame is five empty stage columns.
  Stop-test: fails. MINIMAL fix only: empty-registry state renders a
  welcome block in the center — one sentence + a "Create your first
  project" button that opens the existing New-project dialog. NOT a
  welcome-screen buildout; the dialog we have IS the onboarding.

- [ ] **No ACP/agent onboarding.** (walk, after project creation.) A
  stranger has no way to know whether claude-code / codex are installed
  and authenticated — the product's entire agentic loop depends on it
  and fails opaquely without it. Director: "I need to be led through
  some sort of onboarding to check my ACP connections" … "then show the
  approp models in the picker." Stop-test: fails hard (chat that never
  answers = closed tab). Scope TBD when we fix — lean minimal: provider
  health check surfaced at welcome/launcher with install links, not a
  wizard.

- [ ] **Chat agent has no production context — it does the task instead
  of building the skill.** (walk, first session.) The launcher hands
  the raw brief to a bare session; agent interpreted "improve the
  README" as *do it now*, not "research/draft a skill that does this."
  Nothing tells the session: you are in Skillmaker Studio, this bundle
  exists for skill X at stage Y, your job is research → design →
  draft, the CLI is your hands, stages are human-gated. This IS the
  queued "William prompts" workstream arriving as an E2E blocker — the
  loop cannot complete correctly without it. Scope for fix: a system
  prompt / first-message preamble injected into launcher-started
  sessions (and resumed ones), stage-aware. The station agents have
  skills for this; CHAT is the naked path.
  **Walk update — partial self-recovery:** the agent then read the
  bundle (empty design/dossier/risk-map, idea stage), FOUND the
  research/drafting guidance on its own, corrected course ("create an
  initial tested bundle rather than pretending there's a README here
  to edit"), and STOPPED per the guidance's refusal-on-vague-input
  rule — asked for a concrete repo/README + audience before
  researching. So: the guardrails work once discovered; the blocker is
  that discovery is LUCK (it happened to read the right files), not
  design. The fix is making minute-zero context guaranteed, and the
  recovery transcript is the spec for what it must say.
  **Director's hand-written recovery message = the preamble template:**
  "you're inside Skillmaker Studio. your job is to help me create a
  SKILL that I can re-use [to do X] in other projects, not this one.
  you're inside a skill called [slug] and we're gonna create a
  skillmaker bundle together to eventually ship the SKILL.md. next
  step is [stage-appropriate step]." Parameterize: slug, one-liner,
  stage, next step. Also: agent-home injection already carries the
  William guidance (walk evidence: agent read
  agent-home/codex/skills/.system + william-*) — the preamble mainly
  needs to POINT at it ("read your guidance first").
  Open design question (director, mid-walk): is agent-home filesystem
  bundling the right delivery at all, vs session-level injection?
  Constraint: ACP session/new has NO system-prompt/context param — so
  "session injection" today = prepending the preamble to the first
  user message; protocol-level context is an upstream ACP wish, not a
  dependency. Two-layer shape proposed: corpus via agent-home,
  activation via first-message preamble.
  Related director musing (mid-walk): should chat agents be required to
  PRODUCE via the CLI ("lock that down, i dunno")? Root issue: raw file
  writes emit no journal events → dots/live-refresh/activity/provenance
  all blind to chat-path work. Options sketched: (a) funnel milestone
  landings through skillmaker commands (D6-pure, needs command surface,
  enforcement fights the agent's grain), (b) server watches bundle dirs
  during sessions and mints observed events, (c) hybrid: declared
  milestones + witnessed edits. Design conversation, not this week.

- Chat composer is a one-line input, not the growing textarea the
  launcher got — "super annoying to type in." BORDERLINE: strict test
  says papercut, but Blocker #5 currently forces users to type long
  steering paragraphs into it, which compounds. Same 10-minute fix as
  the launcher textarea. Director to rule: batch with blockers or park.

- Sidebar doesn't live-refresh: newly created skill absent under its
  project until page reload (Sidebar fetches projects once on mount /
  on-register — no journal-tick subscription, unlike Board/views).
  Disorienting ("did it work?") but the center view IS the new skill
  and reload recovers. PARKED-HIGH — cheap fix (subscribe loadProjects
  to the live-refresh tick), strong candidate for the batch.

- Overview empty state says "start a chat and frame it" while a chat
  is visibly running in the right panel. Copy doesn't know the session
  state. PARKED — one conditional string.

- Tool-call presentation in chat: dense undifferentiated rows; many
  could be collapsed/grouped (reads, greps) with only meaningful ones
  surfaced (edits, searches, skillmaker commands). PARKED — presentation
  design, not a stopper.

- Relative file links in chat markdown (research/notes.md, bundle.json)
  resolve as browser URLs → 404 in a new window. Should intercept
  bundle-relative links and open them in the Files panel (onOpenFile
  plumbing already exists). PARKED — trust-diminishing but not a
  stopper; the Research tab shows the same file.

- Director design idea: agent should be able to FORCE-NAVIGATE the UI —
  research completes → you're taken to (or strongly pulled toward) the
  Research tab. Connects to the D9 direct-manipulation amendment (the
  session isn't just transport — it can drive the surface) and the
  unread-dot mechanics (dots may be too quiet for stage-exit moments).
  PARKED — design conversation, not this week. Counter-consideration to
  weigh then: stealing focus/navigation from a user mid-thought is its
  own trust cost; "pull" vs "yank" needs care.

- **Research unread dot never fired** after chat-produced research.
  Diagnosed cause: the dot listens for `station.`/`review.` journal
  events — but CHAT-path work writes files without station events, so
  the dot's trigger never happens. The dot mechanic assumed stations
  are the only producers; chat is now a first-class producer. PARKED —
  fold into the "how does landed work announce itself" design
  conversation (with force-navigate idea above).

- **Research tab rendered a truncated notes.md** (stopped after the
  first bullet; "open in Files" showed the full file — rescue worked).
  Cause unknown: fetched-mid-write? markdown renderer choking on the
  agent's loose list style? size cap? INVESTIGATE at fix time.
  PARKED-HIGH — a tester who doesn't spot "open in Files" reads this
  as "my research is gone."

- **Markdown renderer breaks bulleted lists on wrapped lines.** Source
  verified CORRECT (two-space-indented continuation lines, standard
  CommonMark); renderer splits at the newline and emits the
  continuation as a root paragraph. Garbles every well-authored list
  in research docs/SKILL.md renders. PARKED-HIGH — readable but makes
  agent output look broken; renderer fix, batch candidate.

- Chat composer loses typed-but-unsent text when switching tabs/views
  (state dies with the component). Persist draft per skill
  (localStorage), and probably scroll position too. Losing typed words
  is one of the angriest small bugs a product can have — batch
  candidate with the composer-textarea fix (same component, one pass).

- **The product never states the next step.** Pipeline is notes.md →
  design.md (co-authored in CHAT — no station owns it, deliberately) →
  SKILL.md; the director had to recall this from memory ("isn't next
  step design.md?"). A tester has dead silence after research. The
  stage-aware "next step" line belongs in the Blocker-#5 preamble AND
  somewhere visible on the skill page. Fold into #5's scope: the
  preamble template's "[next step]" slot must encode the real
  pipeline, including "design.md happens in conversation."
  Corollary from the walk: the research leg ended with eight open
  design questions BURIED at the bottom of notes.md — chat summary
  named their count and went silent. In chat, finishing research
  should HAND OFF: surface the open questions and offer to work them
  into design.md together. Station-shaped guidance ("write notes,
  stop") is correct for stations and too passive for conversation —
  the William guidance needs a chat-mode coda. (→ William-prompts
  workstream, same fix family as the preamble.)
  DIRECTOR (2026-07-30, reading william-research): "there's no loop
  for asking me all the open questions and iteratively updating
  notes.md until they are all cleared. we need to add that in." →
  chat-mode elicitation loop: surface open questions one-by-one,
  update notes.md per answer, until cleared — then the design handoff.
  Station mode keeps the current write-and-stop discipline (no human
  in the sandbox). One mode-awareness edit covers loop + coda.
  Validated by the director doing it manually and rating it good.

- **Resume is provider-gated and hidden behind the default selection.**
  Reopening chat shows the idle "start a session" state; the Resume
  button only appears once you switch the picker to the provider that
  owns the stored session. Reads as "my conversation is gone."
  DIRECTOR RULING (2026-07-30): chat should AUTO-RESUME the existing
  session whenever the panel opens — resume is not a user action; the
  picker should follow the session, not gate it. PARKED-HIGH, top of
  the batch — for testers this is near-blocker (lost-work feeling on
  every reopen).

- Design question (director): switching model/HARNESS mid-session
  feels weird. Split at fix time: model/effort switching WITHIN a
  provider is protocol-supported (set_model) and legitimately useful;
  switching PROVIDER mid-session can't continue the session and should
  be an explicit "start new session with codex?" action, not a quiet
  dropdown flip. The selector currently presents both as the same
  gesture.

- Overview tab after a draft lands: shows only the H1 + "Open full
  SKILL.md" — no description frontmatter, no trigger phrasing, no body
  slice (firstSection() found nothing between H1 and first H2).
  "Annoying" — the skill's front page tells you nothing about the
  skill. PARKED but = task #3 (Overview enrichment), now
  field-validated: description + when-to-use belong here at minimum.

- Draft→evals handoff also silent (third occurrence: research→design,
  design→draft, draft→evals). The coda gap is systemic, not
  per-skill. Already specced under Blocker #5.

- NOTE for William-prompts scope: there is NO evals-authoring guidance
  at all — william-research and william-draft exist; nothing owns
  "risk map + fixtures from failure hypotheses + proof spec." The
  evals leg of the walk runs on a bare agent. Expect a quality dip —
  whatever happens next is unguided-baseline data.

- Eval tab didn't auto-refresh as fixtures/risks landed — force-reload
  required (though then everything showed). Notable because `fixture
  add` DOES write journal events, so the SSE tick should have fired:
  either the viewer's evals fetch isn't tick-subscribed or the
  project-tagged stream isn't reaching this view post-registry.
  PARKED-HIGH — investigate with the sidebar-refresh + dot family
  (one "live updates don't reach surfaces" cluster).

- [ ] **"No response captured" shown for runs whose response EXISTS.**
  (walk, first fixture run.) response.md on disk + endpoint 200, but
  the viewer fetched early (recorder still writing), got 404, and
  cached null permanently (ensureRunResponse caches per-run, never
  retries). Grading UI then invites a BLIND Pass/Fail while claiming
  no evidence exists — breaks the evidence loop's honesty at its
  center. BLOCKER: fix = retry/invalidate on run completion events
  (or don't cache 404 while run is fresh). Same root family as
  sidebar/evals/dot staleness — the batch's live-update cluster is
  now load-bearing, not cosmetic.

- Two version pickers visible at once on the Eval tab: the top-level
  Time-Machine pivot (Current draft / 3f38ca68) AND the tab's own
  "Version: Latest … / All versions" scope row. They mean different
  things — pivot = which draft you're VIEWING, scope = which versions'
  MEASUREMENTS count — but they look like the same control twice.
  The 2026-07-25 ruling was top-level pivot subsumes per-tab pickers;
  the Eval tab's row predates it and survived. Fold at fix time: pivot
  owns the version; the tab keeps only a latest/all EVIDENCE toggle,
  restyled so it doesn't read as a second version picker. PARKED
  (Evals frozen zone).

## Papercuts (parked — do not fix this week)

- Welcome v2: first-run detection of existing skill homes
  (`~/.claude/skills`, `~/.agents/skills`, …) offered as one-click
  project imports. Compelling for onboarding magic + the "what would
  you use it for" question; NOT needed to complete E2E. (director idea,
  parked by the discipline)

- Model picker says only "Default (recommended)" — tells the stranger
  nothing about which model that is. Adapter descriptions exist on the
  wire; show them. Ties into the ACP-onboarding blocker ("then show the
  appropriate models in the picker") — fold into that fix, not separate.

- Launcher → chat handoff: brief flash of the "Start a session" idle
  state (with button) before the intro-message session actually starts.
  Cosmetic race between navigation and chatIntro consumption; stranger
  might click the button during the flash (double-session risk worth
  checking when fixed). PARKED.

- Chat panel in EXPANDED mode: content stays in a ~360px left column
  (messages, tool rows, composer) instead of using the expanded width —
  looks broken. Likely a fixed/max width that ignores the width=9999
  expanded pass-through. PARKED (ugly, not a stopper — un-expanded
  panel renders fine).

## Design directions surfaced by the walk (for post-week rulings)

- **"The Research tab IS the station"** (director, mid-walk): the tab
  should reflect done/not-done — notes.md ✓, open questions
  unresolved, design.md missing — and the transition to drafting
  should be GUARDED on design.md existing. Note what this implies for
  the open stage-model question: stages stop being rooms work sits in
  and become READINESS STATES the tabs surface — which is exactly
  PMS's ready/confirm Board mechanic (harvest §5) arriving via the
  from-scratch test, as predicted. Artifact-existence guards
  (design.md before drafting) are concrete and rulable; the Guarded
  Transition mechanism exists, it just doesn't check artifacts today.

- **Stage said "Idea" through completed research and active design.**
  Nobody advanced it: the agent refuses to (correctly), the director
  wasn't told to, and chat-path work ignores stages entirely. The
  artifacts and tabs carried the true state; the stage field carried
  nothing. If the walk completes e2e without the ladder ever mattering,
  that is the from-scratch test's verdict on the stage model: stages as
  DECLARED states are dead weight in the chat path; stages as DERIVED
  readiness (research/notes.md exists ✓, design.md exists ✓, …) match
  what actually happened. Reinforces "the tab IS the station" +
  PMS ready/confirm. Note the fork this creates: either chat work
  learns to advance stages (CLI-funneling musing) or stages learn to
  derive from artifacts.

- **design.md has no home in the tabs.** Research tab shows research/*
  only; design.md is Files-panel-only. The design station lacks both a
  UI and a place for its artifact. Options for the ruling: Research
  tab grows into Research+Design (cheap, muddies two stations), or
  Design becomes its own tab between Research and Eval (matches the
  pipeline and PMS's first-class Design view; task #5 was already
  pointed here). Director's "the tab IS the station" direction implies
  the latter.

- **Claims storage ruling forming** (director, mid-walk, firm):
  risk-map.md as a parsed markdown table is "lame" — structured data
  belongs in structured files. Direction: claims move to a
  bundle-level structured source (claims file or journal events);
  fixtures reference claim ids; any markdown view is a RENDER, not
  the source. Invariant to preserve: gap claims (no fixture) need the
  bundle-level home — per-fixture files can't be the only store.
  Also: RULED (2026-07-30): rename `case.json` → `evals.json`
  (director's pick over my fixture.json suggestion). Schedule with
  the claims-storage restructure — one migration, not two. Same prose-vs-source family as the
  step-graph proposal — one coherent future ruling. NOT this week.
  FIRMED (director, same conversation): "risk-map.md should be
  completely subsumed by json-stored data. all reads/writes to that
  json data should be enacted through the CLI." Note what the CLI
  door buys beyond hygiene: every claim mutation becomes a journal
  event for free → unread dots, activity, provenance, and the
  chat-path-invisibility problem all resolve for claims data. This +
  the earlier CLI-funneling musing are converging on one architecture:
  STRUCTURED DATA BEHIND CLI DOORS, PROSE AS RENDER, EVENTS AS
  WITNESS. (Candidate Danvers-brief headline.)

- **Grading granularity gap** (director, at the first grade): a
  fixture probing 4–5 risks gets ONE run-level Pass/Fail — "it could
  pass some and fail others" and the model can't express that; the
  grade paints every joined claim alike. Near-term mitigation:
  fixture-scoping discipline (one risk / tight cluster per fixture) →
  evals-authoring guidance line. Real fix candidate: per-risk grading
  (measurement keyed by fixture × version × model × risk). This is
  THE unsettled Evals question made concrete — feed into the frozen
  Evals redesign when it thaws.

- **Evals vocabulary: study smeval** (director, 2026-08-03): Simon
  Willison's new eval tool — adopt/align our evals vocabulary with it
  where it clarifies ("I think that renaming will help us bring some
  clarity to the evals experience"). Fold into the claims-storage /
  evals.json restructure and the frozen Evals redesign — recon smeval's
  terms (eval/case/run/score/…) before naming anything new.

- QA walk 2026-08-08 (director, note only — not for build yet):
  (1) RULED: chat-transcript file links should open the doc in the
  Files panel (upgrade of the parked 404-links papercut — intercept
  bundle-relative links → onOpenFile).
  (2) Musing: the Files tab may want to become TABS — multiple open
  documents, ChatGPT-desktop style.
  (3) Musing: "chat on the left may actually be stronger" — chat is
  becoming the primary work surface ("I'm doing many things through
  chat"); layout inversion candidate. Both musings are center-panel
  IA questions for the next design pass with Danvers (relates to #204
  prototype + the D9 direct-manipulation amendment).

## Session log

**PAUSED mid-walk** at the design station: director answering the
research's eight open questions one-by-one in chat ("has been good");
next actions on resume: (1) finish answers, (2) paste the design.md
instruction (Intent / When-to-use / Workflow / Failure-hypotheses
shape), (3) review design.md, (4) drafting leg, (5) evals, (6) publish
— where the deferred "what does success look like" ruling happens.
Walk state: install ✓ project ✓ birth ✓ research ✓⭐ design ◐.
Open blockers: welcome screen (WIP uncommitted), chat context preamble.

- ⭐⭐ EVALS LEG (2026-07-30): the UNGUIDED agent, told only "author
  the evals," VOLUNTARILY funneled all 10 fixtures through `skillmaker
  fixture add` — its own words: "so the Studio journal and index
  remain authoritative." The CLI-doors architecture the director ruled
  an hour earlier, discovered independently by a bare gpt-5.6-sol
  because the CLI affordance existed and was discoverable. 23
  family-banded risks from the failure hypotheses, 10 proof-spec
  fixtures with provenance comments and no slug-naming (trigger
  convention honored), honest closing: "No fixtures were run or
  graded." The unguided baseline turned out HIGH — the agent-layer
  design (D6) is doing the guidance work the missing evals skill
  doesn't.

2026-07-29 walk (fresh home, npx 0.6.1):
- ⭐ Research leg VERDICT: "research content is REALLY good! I think
  the william skill did its work well" — william-research guidance,
  driven by codex gpt-5.6-sol[high] through the naked chat path (once
  hand-given context), produced genuinely good research: real sources
  (GitHub docs, Open Source Guides, Google, Diátaxis), a thesis, an
  evidence hierarchy, failure cases, open design questions. The core
  product wager (agent-first production, human judgment at gates)
  held on the first outsider-shaped attempt.
- Landed on empty Board → BLOCKER 3 (welcome + create-project CTA;
  minimal fix started, WIP uncommitted, finishing AFTER the walk).
- Created project `skills-test` via dialog — no friction reported.
- Model picker copy thin → parked, folded into ACP onboarding.
- ACP-connection check missing → BLOCKER 4.
