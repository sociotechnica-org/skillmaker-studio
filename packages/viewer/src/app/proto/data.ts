/**
 * PROTOTYPE — stand-in data (usability remodel, 2026-08-05).
 *
 * Deliberately hand-written, not fetched: the point of this route is to
 * argue about SHAPE without waiting on wire work. Figures are illustrative
 * except where the repo already has the fact (the two `william-*` skills
 * are real bundles under skills/).
 *
 * Three skills on purpose, at three different fullnesses — a mature card,
 * a half-built one, and a brand-new one that is almost entirely gray. The
 * gray card is the important one: it's what "shows the possible" has to
 * feel like on day one without reading as a chore list.
 */
import type { Folder } from "./catalog.ts";

export type Fill =
  | { readonly kind: "prose"; readonly text: string; readonly meta: string }
  | { readonly kind: "list"; readonly items: ReadonlyArray<{ readonly t: string; readonly d?: string }> }
  | { readonly kind: "files"; readonly files: ReadonlyArray<{ readonly name: string; readonly note: string }> }
  | { readonly kind: "stat"; readonly value: string; readonly sub: string; readonly tone?: "good" | "warn" | "bad" }
  | {
      readonly kind: "heat";
      readonly groups: ReadonlyArray<{
        readonly cat: string;
        readonly note: string;
        readonly cells: ReadonlyArray<{ readonly label: string; readonly heat: 0 | 2 | 3 | -1 }>;
      }>;
    }
  | { readonly kind: "table"; readonly head: ReadonlyArray<string>; readonly rows: ReadonlyArray<ReadonlyArray<string>> }
  | {
      readonly kind: "lineage";
      readonly nodes: ReadonlyArray<{ readonly mark: string; readonly name: string; readonly note: string; readonly self?: boolean }>;
    };

export type SkillStage = "Idea" | "Research" | "Drafting" | "Evals" | "Published";

export type ProtoSkill = {
  readonly slug: string;
  readonly project: string;
  readonly oneLiner: string;
  readonly tags: ReadonlyArray<string>;
  readonly stage: SkillStage;
  readonly version: string;
  /** Block id → what's in that file. Absent id = the file doesn't exist yet. */
  readonly fills: Readonly<Record<string, Fill>>;
};

// --------------------------------------------------------------- the skills

const DRAFT_FILLS: Record<string, Fill> = {
  instructions: {
    kind: "prose",
    meta: "218 lines · edited 2 days ago",
    text: `---
name: william-draft-skill-md
description: Drafts output/SKILL.md from an approved design.md, without inventing scope.
---

# Draft SKILL.md

Turn an approved \`design.md\` into a shippable \`output/SKILL.md\`.

## When to use this

The bundle has a \`design.md\` that a human has approved, and no
\`output/SKILL.md\` yet — or one that has drifted from the design.

## The rule that matters

Every constraint in design.md survives into the draft. You may compress
and re-order. You may not add scope the design didn't ask for…`,
  },
  trigger: {
    kind: "prose",
    meta: "1 line · the whole ballgame",
    text: "Drafts output/SKILL.md from an approved design.md, without inventing scope.",
  },
  scope: {
    kind: "list",
    items: [
      { t: "Does", d: "Turns an approved design.md into a shippable SKILL.md." },
      { t: "Refuses", d: "Writing design.md; touching research/ or evals/." },
      { t: "Fit", d: "Keeps every design.md constraint; declines when design.md is empty." },
    ],
  },
  references: {
    kind: "files",
    files: [
      { name: "skill-md-conventions.md", note: "house style the draft is held to" },
      { name: "frontmatter-spec.md", note: "what the description line must do" },
    ],
  },
  design: {
    kind: "prose",
    meta: "94 lines · approved by Jess Martin",
    text: `## Why a separate drafting skill

Research and drafting fail differently. Research fails by missing
context; drafting fails by *adding* it — the model helpfully invents a
step the design never asked for, and nobody notices because it reads
well. Splitting them means the drafting skill can be held to exactly one
rule, and that rule can be fixtured…`,
  },
  notes: {
    kind: "prose",
    meta: "41 lines · from the research station",
    text: `Looked at 11 hand-written SKILL.md files across three repos. The good
ones share a shape: a trigger line that names the *situation*, not the
capability, and a body that front-loads the refusals…`,
  },
  failures: {
    kind: "list",
    items: [
      { t: "Invents scope", d: "adds a step design.md never asked for" },
      { t: "Drops a constraint", d: "compresses away a hard rule" },
      { t: "Weak trigger", d: "describes the capability, not the situation" },
      { t: "Leaks research", d: "pastes rationale into the shipped file" },
      { t: "Empty-input bravado", d: "drafts anyway from a blank design.md" },
    ],
  },
  pipeline: {
    kind: "list",
    items: [
      { t: "← upstream", d: "william-research-a-skill hands over design.md + research/" },
      { t: "● this skill", d: "reads design.md → writes output/SKILL.md" },
      { t: "→ downstream", d: "evaluating → dist/skills takes output/SKILL.md" },
    ],
  },
  claims: {
    kind: "list",
    items: [
      { t: "Keeps every constraint", d: "proven · 2 fixtures" },
      { t: "Declines on empty input", d: "proven · 1 fixture" },
      { t: "Trigger names a situation", d: "partial · 1 fixture" },
      { t: "Never leaks research/", d: "gap · no fixture" },
    ],
  },
  fixtures: {
    kind: "files",
    files: [
      { name: "golden-full-design/", note: "the happy path, end to end" },
      { name: "empty-design/", note: "must decline, not draft" },
      { name: "constraint-heavy/", note: "7 constraints, all must survive" },
      { name: "trigger-quality/", note: "situation vs capability" },
    ],
  },
  risk: {
    kind: "heat",
    groups: [
      { cat: "The world", note: "1 of 3 models proven", cells: [{ label: "Opus ✓", heat: 0 }, { label: "Sonnet", heat: 3 }, { label: "Haiku", heat: 3 }] },
      { cat: "Neighborhood", note: "handoffs not re-checked", cells: [{ label: "upstream", heat: 2 }, { label: "downstream", heat: 2 }, { label: "context", heat: 2 }] },
      { cat: "The job", note: "usage not monitored", cells: [{ label: "scope", heat: 2 }] },
      { cat: "The people", note: "fully accounted for", cells: [{ label: "reviews", heat: 0 }, { label: "versions", heat: 0 }, { label: "forks", heat: 0 }] },
      { cat: "The skill", note: "output is the blind spot", cells: [{ label: "Input", heat: 0 }, { label: "Reasoning", heat: 2 }, { label: "Output", heat: 3 }, { label: "Adversarial", heat: 0 }, { label: "Chain", heat: -1 }] },
      { cat: "Pure luck", note: "2 fixtures below floor", cells: [{ label: "reps · n", heat: 2 }] },
    ],
  },
  coverage: { kind: "stat", value: "3 of 4", sub: "claims with a fixture", tone: "warn" },
  models: {
    kind: "table",
    head: ["Model", "Reps", "Pass", "Latency", "Cost", ""],
    rows: [
      ["Opus 4.8 ✓", "12", "92% [78–98%]", "36s", "1.0×", "proven"],
      ["Sonnet 5", "—", "not run", "—", "≈0.2×", "▸ run 4"],
      ["Haiku 4.5", "—", "not run", "—", "≈0.08×", "▸ run 4"],
    ],
  },
  passrate: { kind: "stat", value: "92%", sub: "on Opus 4.8 · n=12", tone: "good" },
  cost: { kind: "stat", value: "1.0×", sub: "baseline · Opus 4.8" },
  history: {
    kind: "files",
    files: [
      { name: "c4c8cd44 · golden-full-design", note: "pass · Opus 4.8 · 2 days ago" },
      { name: "87a630d0 · constraint-heavy", note: "pass · Opus 4.8 · 2 days ago" },
      { name: "e028b735 · trigger-quality", note: "partial · Opus 4.8 · 2 days ago" },
      { name: "7eb2319b · empty-design", note: "pass · Opus 4.8 · 5 days ago" },
    ],
  },
  versions: {
    kind: "list",
    items: [
      { t: "v0.3 · HEAD", d: "recorded Jul 12" },
      { t: "v0.2", d: "recorded Jul 12" },
      { t: "v0.1", d: "recorded Jul 11" },
    ],
  },
  lineage: {
    kind: "lineage",
    nodes: [
      { mark: "—", name: "origin", note: "not forked from anything" },
      { mark: "●", name: "william-draft-skill-md", note: "this skill · v0.3", self: true },
      { mark: "└─", name: "…-haiku", note: "fork · cheaper model · awaiting first run" },
    ],
  },
  custody: {
    kind: "list",
    items: [
      { t: "Created", d: "Jess Martin · Jul 11" },
      { t: "Last change", d: "Jess Martin · Jul 12" },
      { t: "Reviews", d: "2 approved · human-gated" },
    ],
  },
  install: { kind: "stat", value: "in sync", sub: "~/.claude/skills · at v0.3", tone: "good" },
};

const RESEARCH_FILLS: Record<string, Fill> = {
  instructions: {
    kind: "prose",
    meta: "156 lines · edited 6 days ago",
    text: `---
name: william-research-a-skill
description: Researches a proposed skill and produces an approved design.md.
---

# Research a skill

Before anyone drafts, find out what the skill actually has to survive…`,
  },
  trigger: {
    kind: "prose",
    meta: "1 line",
    text: "Researches a proposed skill and produces an approved design.md.",
  },
  notes: {
    kind: "prose",
    meta: "212 lines · from the research station",
    text: `Three sources agree that the expensive failure isn't a bad draft — it's
a *confidently* bad draft built on research nobody wrote down…`,
  },
  sources: {
    kind: "files",
    files: [
      { name: "anthropic-skill-authoring.md", note: "vendor guidance" },
      { name: "internal-postmortems/", note: "4 skills that went wrong" },
      { name: "prior-art-survey.md", note: "11 hand-written SKILL.md files" },
    ],
  },
  decisions: {
    kind: "list",
    items: [
      { t: "Split research from drafting", d: "they fail differently" },
      { t: "design.md is the handoff", d: "one file, human-approved" },
      { t: "No web fetch in the loop", d: "sources go in by hand, on purpose" },
    ],
  },
  claims: {
    kind: "list",
    items: [
      { t: "Produces an approvable design.md", d: "partial · 1 fixture" },
      { t: "Names failure modes before drafting", d: "gap · no fixture" },
    ],
  },
  passrate: { kind: "stat", value: "—", sub: "no fixtures run yet", tone: "warn" },
  versions: { kind: "list", items: [{ t: "v0.1 · HEAD", d: "recorded Jul 10" }] },
  custody: {
    kind: "list",
    items: [
      { t: "Created", d: "Jess Martin · Jul 09" },
      { t: "Reviews", d: "1 pending" },
    ],
  },
};

const RELEASE_FILLS: Record<string, Fill> = {
  trigger: {
    kind: "prose",
    meta: "1 line · draft, not reviewed",
    text: "Writes release notes from a tag range, in the house voice.",
  },
};

export const SKILLS: ReadonlyArray<ProtoSkill> = [
  {
    slug: "william-draft-skill-md",
    project: "skillmaker-studio",
    oneLiner: "Drafts output/SKILL.md from a bundle's design.md.",
    tags: ["meta", "stations"],
    stage: "Published",
    version: "v0.3",
    fills: DRAFT_FILLS,
  },
  {
    slug: "william-research-a-skill",
    project: "skillmaker-studio",
    oneLiner: "Researches a proposed skill and produces an approved design.md.",
    tags: ["meta", "stations"],
    stage: "Evals",
    version: "v0.1",
    fills: RESEARCH_FILLS,
  },
  {
    slug: "release-notes",
    project: "skillmaker-studio",
    oneLiner: "Writes release notes from a tag range, in the house voice.",
    tags: ["ops"],
    stage: "Idea",
    version: "—",
    fills: RELEASE_FILLS,
  },
];

// ----------------------------------------------------------------- the work

/**
 * Board columns are WORK STATES, not skill stages — that's the remodel.
 * A stage is a property of a skill (it lives on the card); a column here
 * answers "is anything happening, and does it need me?".
 */
export const COLUMNS = ["Queued", "Running", "Needs you", "Landed"] as const;
export type Column = (typeof COLUMNS)[number];

export type Work = {
  readonly id: string;
  /** A verb. Always. If you can't phrase it as a verb it isn't work. */
  readonly title: string;
  readonly skill: string;
  readonly column: Column;
  /** Block ids this work fills in — the join between Board and card. */
  readonly produces: ReadonlyArray<string>;
  readonly kind: "build" | "split-test" | "review" | "research" | "eval";
  readonly detail: string;
  readonly log: ReadonlyArray<string>;
  readonly age: string;
};

export const WORK: ReadonlyArray<Work> = [
  {
    id: "w1",
    title: "Split-test on Haiku 4.5",
    skill: "william-draft-skill-md",
    column: "Running",
    produces: ["models", "cost", "latency"],
    kind: "split-test",
    detail: "Head-to-head against the Opus baseline on all four fixtures. ~12× cheaper if it clears the bar.",
    log: [
      "forked → william-draft-skill-md-haiku",
      "running golden-full-design · rep 3 of 4",
      "constraint-heavy · pass",
      "empty-design · pass",
    ],
    age: "running 4m",
  },
  {
    id: "w2",
    title: "Author fixture for “never leaks research/”",
    skill: "william-draft-skill-md",
    column: "Queued",
    produces: ["fixtures", "coverage"],
    kind: "eval",
    detail: "The one claim with no fixture. Until this exists the claim is a wish.",
    log: [],
    age: "queued 1d",
  },
  {
    id: "w3",
    title: "Approve design.md",
    skill: "william-research-a-skill",
    column: "Needs you",
    produces: ["design", "custody"],
    kind: "review",
    detail: "The research station is holding. It wants a human to approve the design before drafting starts.",
    log: ["station: researching → awaiting-review", "artifact: research/design.md"],
    age: "waiting 2d",
  },
  {
    id: "w4",
    title: "Measure latency",
    skill: "william-draft-skill-md",
    column: "Queued",
    produces: ["latency"],
    kind: "eval",
    detail: "Nobody has timed a real invocation. The card has a gray well where the number goes.",
    log: [],
    age: "queued 3h",
  },
  {
    id: "w5",
    title: "Draft SKILL.md",
    skill: "release-notes",
    column: "Needs you",
    produces: ["instructions", "scope"],
    kind: "build",
    detail: "The skill is an idea and a trigger line. Chat is open — it's waiting on you to say what it refuses to do.",
    log: ["chat session open · 3 messages"],
    age: "idle 5h",
  },
  {
    id: "w6",
    title: "Run the fixtures",
    skill: "william-draft-skill-md",
    column: "Landed",
    produces: ["passrate", "history", "risk"],
    kind: "eval",
    detail: "12 reps on Opus 4.8 across four fixtures. 92% [78–98%].",
    log: ["4 fixtures · 12 reps", "recorded v0.3", "wrote runs/ · 12 transcripts"],
    age: "landed 2d",
  },
  {
    id: "w7",
    title: "Gather reference material",
    skill: "william-draft-skill-md",
    column: "Landed",
    produces: ["references"],
    kind: "research",
    detail: "Two house-style documents pulled out of the instructions and into output/references/.",
    log: ["wrote output/references/skill-md-conventions.md", "wrote output/references/frontmatter-spec.md"],
    age: "landed 4d",
  },
];

export const FOLDER_TINT: Record<Folder, string> = {
  output: "text-emerald-700",
  research: "text-sky-700",
  evals: "text-amber-700",
  runs: "text-indigo-700",
  record: "text-ink-muted",
};

/** Same hues, quieter — for the path line under a block's label. Spelled out
 *  as literal classes: Tailwind scans source text, so a concatenated
 *  `${FOLDER_TINT[f]}/80` would never make it into the stylesheet. */
export const FOLDER_PATH_TINT: Record<Folder, string> = {
  output: "text-emerald-700/75",
  research: "text-sky-700/75",
  evals: "text-amber-700/75",
  runs: "text-indigo-700/75",
  record: "text-ink-muted/75",
};

export const STAGE_TINT: Record<SkillStage, string> = {
  Idea: "bg-neutral-200 text-neutral-700",
  Research: "bg-sky-100 text-sky-800",
  Drafting: "bg-indigo-100 text-indigo-800",
  Evals: "bg-amber-100 text-amber-800",
  Published: "bg-emerald-100 text-emerald-800",
};

export const KIND_TINT: Record<Work["kind"], string> = {
  build: "bg-indigo-100 text-indigo-800",
  "split-test": "bg-amber-100 text-amber-800",
  review: "bg-red-100 text-red-700",
  research: "bg-sky-100 text-sky-800",
  eval: "bg-emerald-100 text-emerald-800",
};
