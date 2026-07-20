# Skillmaker Studio — Data Model: Bundle, Journal, Index

*Draft for review*

The product rests on three stores — Bundle files, Journal, Index — projected through five motions: Make · Improve · Ship · Receive · Track. A maker drafts a skill and its proof, the Lab pressures it into a measured claim, Ship sends it out with receipts and serves the approved counter, Receive quarantines and routes what arrives, and Track keeps the books. The maker-facing game is earn-the-claim: quality is never asserted, only measured — n · pass-rate · confidence interval, bound to a content-hashed version — and a skill travels with its receipts on a card.

**Status:** Conceptual model (business-readable nouns + relationships), drifting into logical where status/cardinality appear. Not physical (no tables, storage, distribution). Where a capability is settled in shape but deferred in build, it is flagged.

**Depth note:** The Bundle, Journal, and making/improving motions are substantially modeled and shipped. The field loop (Ship/Receive) is modeled to first proof. Authority and Triggers are deliberately scoped to shape only; their build is intentionally deferred behind named tripwires.

## How to Read This Document

Three layers, in order: nouns → relationships → state. Each constrains the next; disagreements get more expensive as you descend, so resolve naming before connection before ownership.

The recurring question is: what is a store, and what is a view of it. Rule of thumb: if nobody wrote it, it's derived; if it's derived, it's never stored.

The practical test: for any screen, name which noun each element renders, which relationship it traverses, and which state it reads/writes. Where that's unclear, a competing data model is hiding.

## Core Structure

### Three Stores, Five Motions, Three Temporal Surfaces

Three stores, each the single home of one kind of fact:

- **Bundle files** (`skills/<slug>/`, `receiving/<id>/`) — content: sources authored, outputs produced, records immutable.
- **Journal** (`events.jsonl`) — state + decisions: what happened, who, when, why. Append-only.
- **Index** (SQLite) — nothing canonical: materialized views + search, rebuilt from scratch anytime.

There is no mutable state file anywhere. Anything that looks like state is a fold of the journal.

Five motions — the studio's jobs, every one a derived view:

- **Make** — draft new skills: Frame · Research · Draft · Proof.
- **Improve** — the workup: the Lab's bench and queue.
- **Ship** — send skills out with receipts; serve the approved counter; publish the Skillbook.
- **Receive** — the inbound membrane: crates, verdicts, the five doors, triage.
- **Track** — keep the books: the Catalog (with its Archive drawer) and the Feed.

The naming law: tabs are verbs (jobs); rooms and artifacts are nouns (furniture); each metaphor stays inside its room.

### Three Temporal Surfaces

- **Definition** — what should happen: design doc, dossier, risk map, stations config.
- **Live status** — what's happening now: runs in flight, awaiting-review, the crate queue, the bench.
- **History** — what happened: the Journal (rendered as the Feed), run records, recorded versions.

### The Four Principles

- **P1 — One canonical home per fact.** Everything else is projection.
- **P2 — Stores are one; views are many.** Surfaces, cards, columns, badges, drawers — all derived, all recomputable. A rename is a label diff.
- **P3 — Artifact classes: source / output / record.** Class decides who writes it and whether it may drift.
- **P4 — The claim loop.** Design states intent; Proof encodes contexts, risks, and success keys as fixtures; runs sample; grades decide; measurements bind to a version; shipping carries receipts; the wild reports back; reports become fixtures. Knowledge ↔ action ↔ evidence, closed.

## Model vs. Machine

A Skill Bundle contains both: the machine (`output/SKILL.md`, the distributable) and its own model (design doc + dossier). The studio does not separate map from territory — it measures the gap: drift compares live hashes against the last recorded version. Displayed, never enforced; deliberate hand-finishing is legitimate, and the model records that and when, not that it's wrong.

Two intent files, two jobs:

- The **design doc** is *how it works* — construction thinking; stabilizes as the skill stabilizes; drift hashes it.
- The **dossier** is *where it lives* — the deployment record; accumulates as long as the skill lives and travels; every gap honest, never blocking.
- The wander test: would the sentence change if the skill worked differently? Design doc. If it were deployed somewhere new? Dossier.

The studio's own documentation (`docs/library/`) documents the studio; it is never the studio.

## Layer 1 — Nouns

What exists.

### The Skill Bundle

The durable asset. Research, design thinking, proof apparatus, runs, outputs, papers — one directory, one slug. The distributable SKILL.md is one of its outputs, not the thing itself. Its parts:

**Identity (`bundle.json`)**
Slug (immutable; keys the journal), name, one-liner, flat tags, targets. Nothing mutable-in-anger: no stage, no status, no flags.

**Design Doc**
Source. How it works: intent, workflow, failure hypotheses, proof spec.

**Dossier**
Source. Where it lives: Job (one), Contexts (many, each a named contract), Out-of-scope, Basis, Evidence, Fit criterion. The card's authored core — the maker fills the card; the file is the backing store, not an editing surface. Contexts may carry structured handoff claims (upstream / downstream / hands): a bundle slug when the neighbor is local, honest free text when not. Claims, not topology.

**Fixture**
Source. One task the skill must survive: prompt, input files, an answer key the agent never sees, a class, the risk ids it covers. Classes — golden · refusal · empty · rerun · hard-case · trigger — prove the Proof triad: trigger proves context, refusal/hard-case/empty prove risks, golden proves keys to success. May name the field report or crate it was harvested from.

**Risk Map**
Source. The authored coverage axis: risk ids in five families (IN/RE/OUT/ADV/CHN), each covered · partial · gap · n/a. No results column — authored coverage and measured validation never merge.

**Output**
Output class. SKILL.md plus resources.

**Skill Version**
A recorded fact, not a file: content hash of the output tree + design hash + optional label. Measurements bind to it; shipments reference it; the card links through it.

**Run**
Record class. One fixture × one version × one provider × one exact model. Immutable once ended; never cleaned up — failures are the curriculum.

**Stations Config**
Source. The per-bundle work plan: which doer (agent | human) does each column's work, with which skill. Copied from a template at creation; frozen with the bundle.

### The Journal

The record

**Journal Event**
One immutable, attributed record (who, when, why): envelope + typed payload. Idempotency-keyed where a duplicate is meaningless; deliberately not where recurrence is signal (re-shipping is real; two reports are two signals). Writes go through the CLI/server only, validated at append. Six families:

- `bundle.*` — created; stage_changed (guarded; backward always legal, reason required — regression is a modeled fact); gate_decided (the publish gate, with evidence); archived / restored (the Retire verb and its undo).
- `review.*` — requested (agent ends its turn; bundle enters awaiting-review) / resolved (approve satisfies the guard; revise becomes the next instruction). Human gates are data, never a blocked process.
- `skill.version_recorded` / `skill.published` — the version fact; the storefront fact.
- `skill.shipped` / `field_report` / `received` / `routed` — the field loop (defined under Ship and Receive).
- `todo.*` — opened / updated / status_changed.
- `run.*` & `station.started` — started / completed / graded (regrade = new event; latest wins, history kept) / repaired.

**Todo**
Journal-native work item — no todo file exists anywhere: kind, status, priority, optional bundle, origin (the field report event or crate that spawned it — distinct id fields per kind). Finished todos are swept after a seven-day grace period: derived, reversible, pin-exempt. Nobody archives a todo; time tidies it.

Not journaled: edits to sources and outputs — git is their history. The journal stays thin: ids and decisions, no fat content.

### The Card

The projection. The per-skill view that makes a skill a portable item, more than its instructions. Three modes: **at home**, derived (never stale, never stored); **traveling**, a snapshot (frozen at departure; the atomic link is the version hash — the card cites it, the skill is verified against it); **arriving**, testimony (every foreign claim recorded and displayed, never trusted, until re-derived locally). The card is deliberately more durable than the skill: instructions can be re-fetched; the evidence trail is the identity.

Card contents (current scope — pure display of existing facts): identity + column/version + drift · models table from measurements with exact pinned model ids · research (dossier + corpus) · lineage (journal replay + fork family) · pipeline (handoff claims, unscored) · coverage in its authored words · growth chips for derivable gaps. Charter: display before derivation, derivation before automation.

**Deck**
All cards.

**Catalog**
The deck's inside index — complete: everything that exists, including the unshipped, the deprecated, the archived. Track's default room.

**Skillbook**
The deck's outside publication — curated: only what shipped, only with receipts. What we stand behind; what you may take. Published from Ship. The two populations never merge — that distinction is the point.

**In Action — Filling Out the Card**
A maker opens a skill's card and sees honest gaps: fit criterion unrecorded, no contexts named, Haiku never run. She types the job and two contexts straight into the card — the words land in the dossier file she never opens. The models tab offers "run 4" next to the unmeasured model. Nothing on the card is asserted; every figure is pinned to a version and an exact model, and every empty field says exactly what nobody has done yet.

### Make

*The drafting studio*

**Column**
Make's working surface: Frame → Research → Draft → Proof — a display over the stored stage ladder. Every advance is guarded by the review pair. Published skills don't live here; published is a card status, not a column.

**Proof**
The fourth column. The maker thinks through contexts of use, risks of failure, and keys to success — with equal weight — and drafts the fixtures and risk map that encode them. Make writes the proof; the Lab runs it.

**In Action — Drafting to Proof**
A station agent researches, drafts, emits review.requested, and ends its turn — the bundle sits in awaiting-review, a fact, not a hung process. The director approves; the guard is satisfied; the column advances. At Proof, the maker names three contexts, five failure hypotheses, and two success keys; six fixtures encode them. The moment fixtures exist and measurements are thin, the Lab bench lights up on its own.

### Improve

*The Lab*

**Bench**
Derived membership, any stage: a skill appears when pressure signals say it needs hands — thin measurements, coverage gaps, drift, open work. A published skill returns the day it drifts. Nobody places a skill on the bench; the signals do.

**Queue**
The work orders: todos, origin-tracked, priority-sorted. At portfolio scale, "redo the research" is a work order here, not a trip back through Make.

**Publish Gate**
The one hard gate, at the top of the ladder: a decision with an evidence basis, journaled.

**In Action — Earning the Claim**
A coverage gap chips onto the bench. The maker authors the fixture, queues thirty runs, grades the read-out; the pass rate becomes a claim with an n and an interval, bound to a hash. At the gate the director reads receipts, not vibes. Weeks later a model drops; the skill drifts; the bench lights up again. Improvement never checks your column.

### Ship

*The outbound dock and the approved counter*

**Shipment**
The departure fact: pinned version, free-text destination and purpose, and receipts — the measurement snapshot frozen at ship time. What it shipped as, not what it measures as today. Re-shipping is a new event, never a duplicate.

**The Counter**
Ship's second side: where an organization's humans and agents come for approved skills — approved meaning the gate passed and a published version is pinned. Publish targets are the storefront machinery. The counter answers three questions from what the studio holds, no telemetry required: which version is approved? has mine drifted from it? has it improved since I took it? The model never claims "live"; it claims shipped, with receipts.

**In Action — The Counter**
A teammate takes the approved version of a skill for their agent workflow — a black box from here. Months later they ask the counter: still current? The counter compares their pinned hash to the approved one: two versions behind, one gap closed since. They pull the new approved version and its card. Nothing was observed out there; everything was answered from in here.

### Receive

*The dock*

**Crate**
An arrived skill with no identity yet — that is the dock's whole point. The crate is the cargo; its card is the paperwork; the intake id is the tracking number. You open a crate to eventually find the bundles that make it into the system.

**Testimony**
The maker's word, recorded at arrival: source, claimed name, claimed version, rights (ours · licensed · unclear), stakes (aside · load-bearing), what hurt. Recorded and flagged, never enforced.

**Verdict**
The machine's derived read, recomputed on every look, never stored: return (hash matches a recorded version — ours, coming home) · new (no overlap) · conflict (name matches, content doesn't).

**The Five Doors**
The human ruling, once per crate, reason required:

- **return** — hash-proof against a named bundle; ours, come home. No file movement.
- **new** — adopt; identity granted; provenance stamped.
- **upgrade** — the crate becomes an existing bundle's next recorded version.
- **fork** — a new bundle with a provenance link to its parent.
- **salvage** — the refusal door, offered under every verdict: no identity, no file movement; the crate stays as strippable evidence. The verdict constrains what the machine suggests, never the human's right to refuse.

**Triage**
The card's batch form, for a whole tree at once: each found skill gets a row. Skip is refusal without a record — nothing enters, nothing is journaled. The maker's own work adopts directly, never touching the dock. Outside work becomes crates for the doors. Entry column is derived from what's observably there (no runnable output → early columns; runnable output → Proof). Usage claims never move a column and never clear the badge — they're testimony, and they may seed fixtures.

**Unverified**
The badge: received and never measured here. Cleared by our first graded proof, never by the maker's receipts. Trust is derived; identity is decided.

**In Action — At the Dock**
A colleague's crate claims to be an upgrade. The verdict says conflict — name matches, content doesn't. The director rules upgrade, reason recorded; the content lands as the next version, wearing Unverified; the first graded run on our own fixtures clears it. Another crate smells wrong: salvage. It never becomes a skill, but its two clever fixtures are harvested before the hulk goes to the Archive drawer.

### Track

*The books*

**Catalog**
Track's default room: everything that exists, sortable; the deck's index — every row a card summary, click through to the card.

**Whereabouts**
A status set, never one location — a skill can be published, shipped, and back on the bench at once: column, last shipment + date, open work, badges. All derived.

**Archive**
The Catalog's back drawer: everything out of commission but kept. Two populations, one place — retired bundles (the Retire verb: journaled, reversible) and salvaged crates (final). You reach into the drawer to find the thing you could use to make a thing; harvest affordances intact on everything in it. Storage never moves; the drawer is a view.

**Feed**
Track's second room: the journal, rendered chronologically. The acts land here ("retired by you, Tuesday — reason: superseded"); the stuff lives in the drawer. A record of decisions, not a place to dig for parts.

**In Action — The Drawer and the Feed**
Building a new intake skill, the maker remembers something like it was refused last month. She opens the Archive drawer — not the feed — filters salvaged crates, finds it, and harvests its prompt scaffolding into a fresh Frame card. The feed, meanwhile, shows the act: salvaged, three weeks ago, reason on record.

### Not Nouns (and Why)

- **The verdict** — a derived recommendation; the human's routing is the noun.
- **A maturity level** — no self-graded maturity exists; triage fills the card and the system derives the entry column.
- **"Live"** — not derivable without telemetry, therefore never claimed. The honest fact is shipped, with receipts.
- **Bench, queue, drawer, feed, columns, counter** — rooms and modes; derived views, not state.
- **Whereabouts** — a computed status set, never a stored location.
- **Heat** — a display idea, not vocabulary; nothing stores or ranks it yet.
- **The five motions themselves** — projections; a tab rename is a label diff.

## Layer 2 — Relationships

How they connect.

### The Bundle

- Workspace has Bundles (1:n). Bundle has fixtures, versions, runs, todos (1:n each); one each of design doc, dossier, risk map, stations config, output tree.
- Measurement binds to version × fixture × provider × exact model — never pooled; a version bump resets displayed validation by construction.
- Run samples; grade decides (append-only); the review pair guards column advances; the publish gate additionally guards the top.

### The Loop

- Shipment references a version, carries frozen receipts.
- Field report may reference a version and destination — tied to a shipment when known; real signal even when not.
- Harvest turns a report or crate into a fixture; a report or crate may mint a todo (origin recorded).

### The Dock

- Crate arrives with testimony; verdict derived from crate hash × the registry as it stands now.
- Routing disposes the crate, once: return/upgrade attach to existing bundles; new/fork mint bundles (fork links to its parent); salvage grants nothing and the crate remains.

### The Views

- Dossier contexts claim neighbors (upstream / downstream / hands).
- The Catalog indexes the Deck; the Skillbook publishes its curated subset; the Archive gathers the retired and the salvaged; the Feed renders the journal.
- Every mutating act carries an Actor.

## Layer 3 — State

Immutable spine: journal events, ended runs, recorded versions, ship receipts, salvaged crates. Mutable surface: sources, identity (append-slowly), todos (via events).

| Noun | Stored | Derived | Operations | Lifetime |
| --- | --- | --- | --- | --- |
| Skill Bundle | identity; sources; output | column, substate, archived (fold); drift; whereabouts; bench membership | new, advance (guarded), retire/restore, adopt | slug forever |
| Design doc / Dossier | prose + frontmatter (+ handoff claims) | drift input; card fields; honest gaps | edit (via card affordances) | living sources |
| Fixture | case, prompt, files, key, class, source | coverage roll-up | author, harvest | persistent |
| Skill Version | journal fact: hashes + label | drift baseline; the approved pin | record | immutable |
| Run | metadata, transcript, artifacts | measurements; guidance tiers | start, complete, grade, repair | immutable once ended |
| Todo | journal events; origin | priority defaults; terminal stamp; swept | open, update, status, pin | journal-native |
| Shipment | event + receipts snapshot | changelog entry | ship | immutable |
| Field report | event | harvestable? (failed / surprise) | report, harvest, mint todo | immutable |
| Crate | directory + testimony event | verdict (never stored); evidence class; Archive membership | receive, route (once) | kept forever, as evidence |
| Journal event | envelope + payload | every fold | append | immutable |
| Index | — | everything | reindex | disposable |

### Derived-State Rules

Verdicts, drift, measurements, badges, bench membership, the sweep, whereabouts, the Archive — derived, never stored. One deliberate inversion: ship receipts are stored, because their job is to be the snapshot live measurements would otherwise drift out from under. A stored snapshot states its reason.

One update path. Only sources are edited; state moves only by events; the Index is rebuilt, never written to directly. A regrade, repair, restore, or re-ship is a new event — latest wins, history kept.

## Authority, Governance & Gates

Deliberately thin — three mechanisms, all data:

- **The review pair** — per-column, non-blocking; every agent action terminates at a human decision on the record.
- **The publish gate** — the one hard gate, decided with evidence.
- **The standing self-grant (override)** — the director may do anything, and the journal records that they did.

A fuller authority layer is settled in shape, deferred in build: grants will be journal events (issued/revoked), enforcement will be append-time guards, checks will be folds — no policy engine. Build tripwires, any one of which reopens it: a second director sharing a workspace; outside-made skills doing station labor; any automation firing unattended (an unattended fire needs a standing grant to fire under).

The dock's law: trust is derived, identity is decided. Testimony is recorded and flagged, never enforced; contradictions trip a flag, never a block.

Two lanes: a mechanical fault (provider down, run stuck) is repaired and never touches measurements; a judgment fault is corrected by more data — backward moves with reasons, regrades, restores.

## Triggers

Nothing fires by itself; every loop-closing motion is an affordance a human taps — the loop is proven by hand before it automates. When automation earns its way in, its shape is settled: a registry of triggers (listable, armable, disarmable — never inline hooks inside event writers); every fire is itself a journal event; and watchers precede actors — a watcher lights up an affordance (no authority needed); an actor acts unattended (requires a standing grant). Triggers and the grant layer gate each other; both wait for the same moment.

## Failure

- Infra-failure and skill-failure never mix — provider faults can't touch pass rates.
- Failures are the curriculum — run records are never cleaned, and a skill that fails in the wild is a new fixture (harvest).
- Regression is a modeled fact — backward column moves always legal, with a reason.
- A stuck run is repaired by an event, not a mutation.
- A surprise report's good-or-bad valence resolves at harvest, where the human picks the fixture class.

## The Reserved-Words Ledger

Normative. New vocabulary checks this table before claiming a word. Name the semantics, scope the noun: a word means one thing everywhere; the journal already scopes by noun prefix; scope never excuses a second meaning.

- **archived** — the bundle membership fact (event-backed, reversible); display verb Retire.
- **Archive** — the place-view: retired bundles + salvaged crates; the Catalog's drawer.
- **swept** — concept: derived, post-completion grace window, reversible, pin-exempt, default-view removal only. Reuse only if all invariants hold.
- **salvage / skip** — refusal with a record / without one.
- **idea, working** — column rung; substate.
- **return, new** — disposition (stored ruling) and verdict (derived read) — mapped in code, never merged.
- **crate** — the pre-identity cargo; intake survives only as its id prefix.
- **Card / Deck / Dossier** — the rendered projection / all cards / the card's authored core.
- **Catalog / Skillbook** — inside + complete / outside + curated; never merged.
- **Unverified** — the badge only; never a display band.
- **fail / failed** — grade verdict / run status / report outcome: three judgments, never merged.
- **published** — ladder rung + event + gate; displays as a card status, not a column.
- **Proof** — Make's fourth column: writing the proof plan. The Lab runs proofs.
- **tags** — findability only; anything you'd sort, gate, or compute on gets its own field.

## Open Questions

| # | Question | Status |
| --- | --- | --- |
| 1 | Authority build-out (shape settled; tripwires above) | Deferred |
| 2 | Trigger registry (shape settled; gated with #1) | Deferred |
| 3 | Heat — a unified "how little we've looked" lens over the card | Filed; earns a build via card usage |
| 4 | World-watch — alerting makers when the model landscape shifts under a measured skill | Filed; needs a model-catalog truth source |
| 5 | Card interchange (a traveling card file) | Filed; tripwire = real cross-workspace exchange |
| 6 | Counter features — approved channel; "you're behind / it improved"; drift-vs-approved for takers | Filed |
| 7 | "Live" status | Only if telemetry ever exists; derived, never asserted |
| 8 | The Feed's long-term fate — distribute into cards + notifications? | Open (design) |
| 9 | Ship + Receive as one Port tab with two wings | Pocketed display option |
| 10 | Salvaged-crate volume at scale (an attic convention) | Revisit at scale; deletion never on the menu |
| 11 | Per-model output variants | Open; hashes already key for it |
| 12 | Proof scaffold parity — contexts and success keys prompted as strongly as risks | Filed fix |

## Deferred To-dos, by Tranche

- **Code, small** — the verdict→disposition table + the enum lockstep test; the todo-origin id split (with read shim); the mechanical renames (swept; deprecated/in-progress; crate vocabulary).
- **Code, medium** — triage reform: maturity self-grade out, card-field elicitation in, derived entry column, stakes/hurts on the received event, dossier handoff claims.
- **Surfaces** — card v1 (display only) → Catalog/Archive/Feed → nav verbs and Make's Proof column. Nav promotion is display-layer and cheap.
- **Docs** — this document to docs/ as source of truth once squared; the studio library reshelved to the motion-era scheme; vision card amended.
- **Jess's domain** — the schema-migration brief (versioned vocabulary; the full name-convergence map with a staged big-bang plan; mirror consolidation) and the authority build option. Neither blocks launch.

## The Modeling Toolkit

Shared vocabulary for the method used to build this model.

- One canonical home per fact — no mutable state files, ever.
- Stores are one, views are many — a view is not a store; a rename is a label diff.
- Source / output / record — the artifact class decides writability.
- Derived is never stored — and a stored snapshot states its reason.
- Append, don't mutate — latest wins, history kept.
- A run is a sample — n · rate · interval, bound to version × provider × exact model, never pooled.
- Trust is derived; identity is decided — testimony recorded and flagged, never enforced.
- Reasons are load-bearing — backward moves and dispositions carry them; the hypothesis is the record.
- Warn, never fail — parsers tolerate; unknown values are preserved and surfaced.
- Prove the loop by hand before automating it — affordances, then watchers, then actors.
- Name the semantics, scope the noun — one meaning per word, everywhere; check the ledger first.
- Tabs are verbs, rooms are nouns — each metaphor stays in its room.
- Display before derivation, derivation before automation.
- Claims, not topology — testimony about surroundings until execution demands real edges.
- Refusal with a record (salvage) vs. without (skip) — choose by whether the refusal is worth keeping.
- One renderer per projection — two views of the same shape must be one renderer twice.
- Don't add a noun until it pays rent.

## Appendix — Provenance: Renames & Resolved Questions

### Renames

Board → Make (the word Board retired; the columns are just columns) · Catalog and Skillbook restored to their original jobs (inside registry / outside book) · Activity → the Feed (Track's second room) · Evaluate (column) → Proof · todo "archived" → swept · adopt lifecycle "archived/idea" → deprecated / in-progress · "Yard" rejected → Archive · maturity ladder → retired (triage fills the card) · "escape hatch" → the standing self-grant · Port → split stands (Ship · Receive), two-wings option pocketed.

### Resolved Questions

The stored-vocabulary freeze (display renames never touch stored values; growth is additive) · one owner per word + the ledger · the verdict→disposition mapping in code, salvage under every verdict · todo-origin id split · the core↔viewer enum lockstep test · stakes/hurts as structured testimony · design-doc/dossier charters + wander test · handoff claims (not topology) · the card's three modes and now/later split · Catalog/Skillbook populations never merged · the Archive as the Catalog's drawer, Retire/Salvage verbs · Make's four columns with Proof · Lab bench derived and column-orthogonal · Ship two-sided (the counter) · triage as card-filling with derived entry · skip vs salvage · surprise valence resolves at harvest · tags carry no second axis · authority and triggers deferred with settled shapes and named tripwires.

Full decision-by-decision reasoning and alternatives: the companion decision docket.
