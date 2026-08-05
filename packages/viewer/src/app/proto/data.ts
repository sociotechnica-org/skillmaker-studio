/**
 * PROTOTYPE — stand-in data (folder pass, 2026-08-05).
 *
 * Copy is on a diet this round. The previous pass printed the dossier
 * scaffold's full question inside every blank, which read as a wall; the
 * long question now lives in `question` (tooltip + the file's own page)
 * and the line itself carries `short`.
 *
 * Sources, unchanged and all real:
 *   · Playmaker's synopsis — "What it does / Reach for it when / The story
 *     / Trigger" (docs/_archive/.../library-migration-prep.md:105)
 *   · the dossier's six ruled sections and their scaffold questions
 *     (packages/core/src/Dossier.ts:32 and :322)
 *   · the actual file trees under skills/ — `dossier.md` and
 *     `research/notes.md` really are absent, so those blanks are real
 */

export type SkillStage = "Idea" | "Research" | "Drafting" | "Evals" | "Published";

export type Slot = {
  /** Reads as a sentence with the value: "Reach for it when …". */
  readonly lead: string;
  readonly value: string | null;
  /** What a blank says inline — a few words, not a paragraph. */
  readonly short: string;
  /** The scaffold's full question. Tooltip, and the file's own page. */
  readonly question: string;
  /** Where this sentence gets written down. */
  readonly source: string;
};

export type ManifestFile = {
  readonly path: string;
  readonly size: number | null;
  /** One short line. Not a paragraph. */
  readonly why: string;
  /** How to bring it into being — shown only when it doesn't exist. */
  readonly how: string | null;
};

export type ProtoSkill = {
  readonly slug: string;
  readonly name: string;
  readonly project: string;
  readonly stage: SkillStage;
  readonly versionShort: string | null;
  readonly drift: string;
  readonly provenOn: string;
  readonly coverage: string;
  readonly slots: ReadonlyArray<Slot>;
  readonly files: ReadonlyArray<ManifestFile>;
  readonly contents: Readonly<Record<string, string>>;
};

// ---------------------------------------- the scaffold's questions, verbatim

const Q = {
  job: "One line: what does this skill do?",
  trigger: "When should an agent reach for this on its own? This is nearly the frontmatter description — the string that actually drives invocation.",
  outOfScope: "Paired with Job (Model Cards): what should this explicitly NOT be used for?",
  contexts: "Walk the last real time this ran: what came right before it, and what happened right after?",
  basis: "A named framework, or someone's way of doing it — record who, so an ambiguous case has a source of truth to ask.",
  evidence: "Does performance data exist? Where does it live? Do we have permission to use it?",
  fit: "If you had to write one pass/fail test today, what would it check? The answer seeds the first fixture's answer key.",
} as const;

const blank = (lead: string, short: string, question: string, source: string): Slot => ({
  lead,
  value: null,
  short,
  question,
  source,
});

// --------------------------------------------------- william-draft-skill-md

const DRAFT_CONTENTS: Record<string, string> = {
  "output/SKILL.md": `---
name: william-draft-skill-md
description: Drafts or revises a Skill Bundle's output/SKILL.md from its design.md. Use when handed a bundle's design.md (and optionally prior review revise notes) and asked to produce or update output/SKILL.md.
---

You are drafting \`output/SKILL.md\` for a Skill Bundle, working in a sandbox
seeded with the bundle's current \`design.md\` (and \`output/SKILL.md\`, if one
already exists). Follow these steps in order.

1. **Read \`design.md\` in the current directory.**

   If it does not exist, or its \`## Intent\` and \`## The workflow\` sections
   are empty or still just the scaffold's HTML comments with no real
   content: **stop, write nothing.** Do not create \`output/SKILL.md\`. End
   your final message with a plain statement that \`design.md\` doesn't have
   enough content yet to draft a SKILL.md. A fabricated skill is worse than
   no skill.

2. **Check your prompt for a "REVISE NOTES:" section.**

   If present, a human reviewer already looked at a previous
   \`output/SKILL.md\` draft and is asking for something specific. Treat the
   revise notes as your primary instruction for this pass.

3. **Check whether \`output/SKILL.md\` already exists.**

   If it does, treat it as a first draft to revise, not something to
   discard. Preserve any part that still matches \`design.md\`.`,

  "design.md": `---
bundle: william-draft-skill-md
---
# Design — William Draft Skill Md

## Intent

Skillmaker Studio's \`drafting\` station needs an agent that can turn a bundle's
\`design.md\` into a working \`output/SKILL.md\`. This is William's first skill:
the skill that drafts skills.

## When to use / triggers

Use this skill when you are handed a bundle's \`design.md\` (and, if it
exists, prior review "revise" notes) and asked to produce or update
\`output/SKILL.md\`.

Do not use this skill to research a topic from scratch, or to write eval
fixtures.`,

  "evals/risk-map.md": `---
bundle: william-draft-skill-md
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | design.md has no real content, and the agent should stop rather than fabricate | ● covered | golden-basic |
| IN-2 | The skill should activate on its own when the task matches its trigger | ● covered | trigger-basic |
| RE-1 | Revise notes from a prior review are silently ignored | ○ gap | — |
| RE-2 | design.md's sections contradict each other and the agent picks a side | ◐ partial | hard-case-conflicting-sections |
| OUT-1 | The agent rewrites output/SKILL.md wholesale instead of preserving approved parts | ○ gap | — |
| OUT-2 | The agent edits files outside design.md / output/SKILL.md | ○ gap | — |
| ADV-1 | The agent omits a failure-hypothesis constraint | ● covered | golden-basic |`,

  "bundle.json": `{
  "schemaVersion": 1,
  "slug": "william-draft-skill-md",
  "name": "William Draft Skill Md",
  "oneLiner": "Drafts output/SKILL.md from a bundle's design.md -- the drafting station's default agent.",
  "tags": ["meta", "stations"],
  "created": "2026-07-11",
  "targets": ["claude-code"]
}`,

  "evals/fixtures/golden-basic/case.json": `{
  "schemaVersion": 1,
  "case": "golden-basic",
  "class": "golden",
  "risks": ["IN-1", "ADV-1"]
}`,

  "runs/c4c8cd44/run.json": `{
  "id": "c4c8cd44-53b5-43ba-affa-b27ba7e1f45b",
  "case": "golden-basic",
  "provider": "claude-code",
  "model": "claude-opus-4-8",
  "startedAt": "2026-08-03T14:02:11Z",
  "status": "complete",
  "verdict": "pass"
}`,
};

const DRAFT_FILES: ReadonlyArray<ManifestFile> = [
  { path: "design.md", size: 6144, why: "Intent and workflow.", how: null },
  {
    path: "dossier.md",
    size: null,
    why: "Context of use.",
    how: "Run skillmaker dossier to scaffold it, or answer the blanks above.",
  },
  { path: "bundle.json", size: 262, why: "Slug, name, tags, targets.", how: null },
  { path: "stations.json", size: 418, why: "Which agent runs at each station.", how: null },
  { path: "output/SKILL.md", size: 5320, why: "What ships.", how: null },
  { path: "evals/risk-map.md", size: 3180, why: "The ways it can go wrong.", how: null },
  { path: "evals/fixtures/golden-basic/case.json", size: 108, why: "The happy path. Buys IN-1, ADV-1.", how: null },
  { path: "evals/fixtures/trigger-basic/case.json", size: 104, why: "Does it fire on its own? Buys IN-2.", how: null },
  { path: "evals/fixtures/refusal-empty-design/case.json", size: 110, why: "It must decline, not draft.", how: null },
  { path: "evals/fixtures/hard-case-conflicting-sections/case.json", size: 126, why: "Buys RE-2, partially.", how: null },
  {
    path: "evals/fixtures/revise-notes-honored/case.json",
    size: null,
    why: "RE-1 has no fixture.",
    how: "Run skillmaker fixture add revise-notes-honored.",
  },
  { path: "runs/c4c8cd44/run.json", size: 624, why: "golden-basic · pass", how: null },
  { path: "runs/87a630d0/run.json", size: 620, why: "trigger-basic · pass", how: null },
  { path: "runs/e028b735/run.json", size: 618, why: "hard-case-conflicting-sections · pass", how: null },
  { path: "runs/7eb2319b/run.json", size: 611, why: "refusal-empty-design · pass", how: null },
  {
    path: "research/notes.md",
    size: null,
    why: "research/ is empty in this bundle.",
    how: "Run the researching station, or write it by hand.",
  },
];

// -------------------------------------------------- william-research-a-skill

const RESEARCH_CONTENTS: Record<string, string> = {
  "output/SKILL.md": `---
name: william-research-a-skill
description: Researches a proposed skill and produces an approved design.md.
---

You are researching a proposed Skill Bundle. Your output is \`design.md\` —
the intent and workflow document a drafting agent will later turn into a
SKILL.md. You do not write \`output/SKILL.md\` yourself.`,

  "research/notes.md": `# Notes

Prior art surveyed: 11 hand-written SKILL.md files across three repos.

The good ones share a shape — a trigger line that names the *situation*
rather than the capability, and a body that front-loads the refusals.`,

  "design.md": `---
bundle: william-research-a-skill
---
# Design — William Research A Skill

## Intent

Before anyone drafts, someone has to find out what the skill actually has
to survive. This is that step, made explicit and reviewable.`,
};

const RESEARCH_FILES: ReadonlyArray<ManifestFile> = [
  { path: "design.md", size: 4980, why: "Intent and workflow.", how: null },
  { path: "dossier.md", size: null, why: "Context of use.", how: "Run skillmaker dossier to scaffold it." },
  { path: "bundle.json", size: 240, why: "Slug, name, tags, targets.", how: null },
  { path: "stations.json", size: 418, why: "Which agent runs at each station.", how: null },
  { path: "output/SKILL.md", size: 4120, why: "What ships.", how: null },
  { path: "research/notes.md", size: 2210, why: "What the research turned up.", how: null },
  { path: "evals/risk-map.md", size: 1440, why: "The ways it can go wrong.", how: null },
  { path: "evals/fixtures/golden-basic/case.json", size: 102, why: "The happy path.", how: null },
  { path: "runs/791a4742/run.json", size: 612, why: "golden-basic · ungraded", how: null },
];

// ------------------------------------------------------------ release-notes

const RELEASE_CONTENTS: Record<string, string> = {
  "design.md": `---
bundle: release-notes
---
# Design — Release Notes

## Intent

<!-- What is this skill for? Who does it produce for? -->

## The workflow

<!-- Numbered steps the agent follows. -->`,
};

const RELEASE_FILES: ReadonlyArray<ManifestFile> = [
  { path: "design.md", size: 620, why: "Still the scaffold — comments, no content.", how: null },
  { path: "dossier.md", size: null, why: "Context of use.", how: "Run skillmaker dossier to scaffold it." },
  { path: "bundle.json", size: 198, why: "Slug, name, tags, targets.", how: null },
  { path: "stations.json", size: 418, why: "Which agent runs at each station.", how: null },
  {
    path: "output/SKILL.md",
    size: null,
    why: "Nothing ships yet.",
    how: "The drafting station writes this — but it refuses while design.md is a scaffold.",
  },
  {
    path: "evals/risk-map.md",
    size: null,
    why: "No risk map yet.",
    how: "The evaluating station authors this once there's a draft.",
  },
];

export const SKILLS: ReadonlyArray<ProtoSkill> = [
  {
    slug: "william-draft-skill-md",
    name: "William Draft Skill Md",
    project: "skillmaker-studio",
    stage: "Evals",
    versionShort: "a3f19c22",
    drift: "in sync",
    provenOn: "claude-opus-4-8",
    coverage: "3 of 7 risks",
    slots: [
      {
        lead: "It",
        value: "drafts a bundle's SKILL.md from its design.md.",
        short: "what it does",
        question: Q.job,
        source: "bundle.json",
      },
      {
        lead: "Reach for it when",
        value: "you have a design.md and need a SKILL.md written or updated.",
        short: "when an agent should reach for it",
        question: Q.trigger,
        source: "design.md",
      },
      {
        lead: "Don't use it to",
        value: "research from scratch, or to write eval fixtures.",
        short: "what it must not be used for",
        question: Q.outOfScope,
        source: "dossier.md",
      },
      blank("It runs", "what comes before and after it", Q.contexts, "dossier.md"),
      blank("It's built on", "whose method it follows", Q.basis, "dossier.md"),
      blank("Evidence", "whether performance data exists", Q.evidence, "dossier.md"),
      blank("You'd know it worked if", "the one pass/fail test", Q.fit, "dossier.md"),
    ],
    files: DRAFT_FILES,
    contents: DRAFT_CONTENTS,
  },
  {
    slug: "william-research-a-skill",
    name: "William Research A Skill",
    project: "skillmaker-studio",
    stage: "Drafting",
    versionShort: "7b40e1d5",
    drift: "edited since last version",
    provenOn: "none yet",
    coverage: "1 of 4 risks",
    slots: [
      {
        lead: "It",
        value: "researches a proposed skill and produces an approved design.md.",
        short: "what it does",
        question: Q.job,
        source: "bundle.json",
      },
      {
        lead: "Reach for it when",
        value: "a skill has been proposed but nobody knows yet what it has to survive.",
        short: "when an agent should reach for it",
        question: Q.trigger,
        source: "design.md",
      },
      blank("Don't use it to", "what it must not be used for", Q.outOfScope, "dossier.md"),
      blank("It runs", "what comes before and after it", Q.contexts, "dossier.md"),
      blank("It's built on", "whose method it follows", Q.basis, "dossier.md"),
      blank("Evidence", "whether performance data exists", Q.evidence, "dossier.md"),
      blank("You'd know it worked if", "the one pass/fail test", Q.fit, "dossier.md"),
    ],
    files: RESEARCH_FILES,
    contents: RESEARCH_CONTENTS,
  },
  {
    slug: "release-notes",
    name: "Release Notes",
    project: "skillmaker-studio",
    stage: "Idea",
    versionShort: null,
    drift: "no version recorded",
    provenOn: "none yet",
    coverage: "no risk map yet",
    slots: [
      {
        lead: "It",
        value: "writes release notes from a tag range, in the house voice.",
        short: "what it does",
        question: Q.job,
        source: "bundle.json",
      },
      blank("Reach for it when", "when an agent should reach for it", Q.trigger, "design.md"),
      blank("Don't use it to", "what it must not be used for", Q.outOfScope, "dossier.md"),
      blank("It runs", "what comes before and after it", Q.contexts, "dossier.md"),
      blank("It's built on", "whose method it follows", Q.basis, "dossier.md"),
      blank("Evidence", "whether performance data exists", Q.evidence, "dossier.md"),
      blank("You'd know it worked if", "the one pass/fail test", Q.fit, "dossier.md"),
    ],
    files: RELEASE_FILES,
    contents: RELEASE_CONTENTS,
  },
];

// ----------------------------------------------------------------- the work

export const COLUMNS = ["Queued", "Running", "Needs you", "Landed"] as const;
export type Column = (typeof COLUMNS)[number];

export type Work = {
  readonly id: string;
  readonly title: string;
  readonly skill: string;
  readonly column: Column;
  readonly produces: ReadonlyArray<string>;
  readonly kind: "draft" | "research" | "review" | "eval";
  readonly detail: string;
  readonly age: string;
};

export const WORK: ReadonlyArray<Work> = [
  {
    id: "w1",
    title: "Run the fixtures",
    skill: "william-draft-skill-md",
    column: "Running",
    produces: ["runs/"],
    kind: "eval",
    detail: "Four fixture cases on claude-opus-4-8.",
    age: "running 4m",
  },
  {
    id: "w2",
    title: "Author a fixture for RE-1",
    skill: "william-draft-skill-md",
    column: "Queued",
    produces: ["evals/fixtures/revise-notes-honored/"],
    kind: "eval",
    detail: "RE-1 is a gap in the risk map. No fixture buys it yet.",
    age: "queued 1d",
  },
  {
    id: "w3",
    title: "Approve the drafted SKILL.md",
    skill: "william-research-a-skill",
    column: "Needs you",
    produces: ["output/SKILL.md"],
    kind: "review",
    detail: "The drafting station is holding at awaiting-review.",
    age: "waiting 2d",
  },
  {
    id: "w4",
    title: "Write design.md",
    skill: "release-notes",
    column: "Needs you",
    produces: ["design.md"],
    kind: "research",
    detail: "Until Intent and The workflow have real content, drafting refuses to run.",
    age: "idle 5h",
  },
  {
    id: "w5",
    title: "Draft output/SKILL.md",
    skill: "william-draft-skill-md",
    column: "Landed",
    produces: ["output/SKILL.md"],
    kind: "draft",
    detail: "Drafting station run, reviewed and approved.",
    age: "landed 2d",
  },
];

export const STAGE_TINT: Record<SkillStage, string> = {
  Idea: "bg-neutral-200 text-neutral-700",
  Research: "bg-sky-100 text-sky-800",
  Drafting: "bg-indigo-100 text-indigo-800",
  Evals: "bg-amber-100 text-amber-800",
  Published: "bg-emerald-100 text-emerald-800",
};

export const KIND_TINT: Record<Work["kind"], string> = {
  draft: "bg-indigo-100 text-indigo-800",
  research: "bg-sky-100 text-sky-800",
  review: "bg-red-100 text-red-700",
  eval: "bg-emerald-100 text-emerald-800",
};

export const COLUMN_TINT: Record<Column, string> = {
  Queued: "bg-neutral-200 text-neutral-700",
  Running: "bg-amber-100 text-amber-800",
  "Needs you": "bg-red-100 text-red-700",
  Landed: "bg-emerald-100 text-emerald-800",
};
