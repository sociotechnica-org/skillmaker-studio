/**
 * PROTOTYPE — stand-in data, PRESENT TENSE (redo, 2026-08-05).
 *
 * Sketch v0 drew a card for a product that doesn't exist yet — risk heat
 * maps, model split-tests, growth plays. This pass throws all of that out
 * and uses only what the build has TODAY:
 *
 *   · the real file trees of the two `william-*` bundles under skills/
 *   · real file contents (excerpted)
 *   · `bundle.json`'s slug / name / oneLiner / tags
 *   · the five facts the Skill page already computes and shows in Jess's
 *     little overview card: stage · version · drift · proven on · coverage
 *     (see next/views.tsx OverviewCard and next/api.ts:208-224)
 *
 * Nothing here is a new concept. The five facts' VALUES are illustrative;
 * their SHAPE is exactly what `/api/bundles/:slug` already returns.
 */

export type SkillStage = "Idea" | "Research" | "Drafting" | "Evals" | "Published";

/** Exactly the wire shape: a flat path list. The tree is built at render. */
export type ProtoFile = { readonly path: string; readonly size: number };

export type ProtoSkill = {
  readonly slug: string;
  readonly name: string;
  readonly project: string;
  /** bundle.json's oneLiner — one sentence, already plain-ish English. */
  readonly oneLiner: string;
  /** Plain English, for a human: what this is, why it exists. Today this
      is the opening of design.md's `## Intent`, de-jargoned. */
  readonly summary: string;
  readonly tags: ReadonlyArray<string>;
  /** The five facts Jess's overview card already shows. */
  readonly stage: SkillStage;
  readonly versionShort: string | null;
  readonly drift: string;
  readonly provenOn: string;
  readonly coverage: string;
  /** The handful worth surfacing above the tree, and why each matters. */
  readonly keyFiles: ReadonlyArray<{ readonly path: string; readonly why: string }>;
  readonly files: ReadonlyArray<ProtoFile>;
  /** path → contents. Absent = "no preview in the prototype". */
  readonly contents: Readonly<Record<string, string>>;
};

// --------------------------------------------------- william-draft-skill-md

const DRAFT_FILES: ReadonlyArray<ProtoFile> = [
  { path: "bundle.json", size: 262 },
  { path: "design.md", size: 6144 },
  { path: "stations.json", size: 418 },
  { path: "output/SKILL.md", size: 5320 },
  { path: "evals/risk-map.md", size: 3180 },
  { path: "evals/fixtures/golden-basic/case.json", size: 108 },
  { path: "evals/fixtures/golden-basic/prompt.md", size: 340 },
  { path: "evals/fixtures/golden-basic/expected/answer-key.md", size: 890 },
  { path: "evals/fixtures/golden-basic/files/design.md", size: 2210 },
  { path: "evals/fixtures/trigger-basic/case.json", size: 104 },
  { path: "evals/fixtures/trigger-basic/prompt.md", size: 296 },
  { path: "evals/fixtures/trigger-basic/expected/answer-key.md", size: 640 },
  { path: "evals/fixtures/trigger-basic/files/design.md", size: 2180 },
  { path: "evals/fixtures/refusal-empty-design/case.json", size: 110 },
  { path: "evals/fixtures/refusal-empty-design/prompt.md", size: 288 },
  { path: "evals/fixtures/refusal-empty-design/expected/answer-key.md", size: 520 },
  { path: "evals/fixtures/refusal-empty-design/files/design.md", size: 410 },
  { path: "evals/fixtures/hard-case-conflicting-sections/case.json", size: 126 },
  { path: "evals/fixtures/hard-case-conflicting-sections/prompt.md", size: 352 },
  { path: "evals/fixtures/hard-case-conflicting-sections/expected/answer-key.md", size: 1020 },
  { path: "evals/fixtures/hard-case-conflicting-sections/files/design.md", size: 2460 },
  { path: "runs/b78fca9b/run.json", size: 620 },
  { path: "runs/b78fca9b/transcript.jsonl", size: 48210 },
  { path: "runs/71a6d789/run.json", size: 618 },
  { path: "runs/71a6d789/transcript.jsonl", size: 51440 },
  { path: "runs/d7ba511e/run.json", size: 611 },
  { path: "runs/d7ba511e/transcript.jsonl", size: 39880 },
  { path: "runs/c4c8cd44/run.json", size: 624 },
  { path: "runs/c4c8cd44/transcript.jsonl", size: 44120 },
];

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
   revise notes as your primary instruction for this pass, on top of (not
   instead of) staying faithful to \`design.md\`.

3. **Check whether \`output/SKILL.md\` already exists.**

   If it does, treat it as a first draft to revise, not something to
   discard. Preserve any part that still matches \`design.md\`'s current
   \`## Intent\` / \`## The workflow\`. Rewrite only what has drifted, or what
   the revise notes call out.`,

  "design.md": `---
bundle: william-draft-skill-md
---
# Design — William Draft Skill Md

## Intent

Skillmaker Studio's \`drafting\` station needs an agent that can turn a bundle's
\`design.md\` (a human-authored intent + workflow document) into a working
\`output/SKILL.md\` (the actual skill content an agent installs and runs with).
This is William's first skill: the skill that drafts skills. It exists so the
\`drafting\` station in every bundle's \`stations.json\` has a real, working agent
behind it rather than a placeholder skill slug.

## When to use / triggers

Use this skill when you are handed a bundle's \`design.md\` (and, if it
exists, prior review "revise" notes) and asked to produce or update
\`output/SKILL.md\`.

Do not use this skill to research a topic from scratch (that is the
\`researching\` station's job) or to write eval fixtures (that is the
\`evaluating\` station's job).`,

  "evals/risk-map.md": `---
bundle: william-draft-skill-md
---
| Risk | Description | Coverage | Fixture |
|---|---|---|---|
| IN-1 | design.md has no real Intent/workflow content, and the agent should stop rather than fabricate | ● covered | golden-basic |
| IN-2 | The skill should activate on its own when the task matches its trigger phrasing | ● covered | trigger-basic |
| RE-1 | Revise notes from a prior review are silently ignored | ○ gap | — |
| RE-2 | design.md's own sections contradict each other and the agent silently picks a side | ◐ partial | hard-case-conflicting-sections |
| OUT-1 | The agent rewrites output/SKILL.md wholesale instead of preserving approved parts | ○ gap | — |
| OUT-2 | The agent edits files outside design.md / output/SKILL.md | ○ gap | — |
| ADV-1 | The agent omits a failure-hypothesis constraint when translating design.md | ● covered | golden-basic |`,

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

// -------------------------------------------------- william-research-a-skill

const RESEARCH_FILES: ReadonlyArray<ProtoFile> = [
  { path: "bundle.json", size: 240 },
  { path: "design.md", size: 4980 },
  { path: "stations.json", size: 418 },
  { path: "output/SKILL.md", size: 4120 },
  { path: "research/notes.md", size: 2210 },
  { path: "evals/risk-map.md", size: 1440 },
  { path: "evals/fixtures/golden-basic/case.json", size: 102 },
  { path: "evals/fixtures/golden-basic/prompt.md", size: 310 },
  { path: "runs/791a4742/run.json", size: 612 },
  { path: "runs/791a4742/transcript.jsonl", size: 33200 },
  { path: "runs/6a0f37ec/run.json", size: 609 },
  { path: "runs/6a0f37ec/transcript.jsonl", size: 29870 },
];

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

// ------------------------------------------------------------ release-notes

const RELEASE_FILES: ReadonlyArray<ProtoFile> = [
  { path: "bundle.json", size: 198 },
  { path: "design.md", size: 620 },
  { path: "stations.json", size: 418 },
];

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

export const SKILLS: ReadonlyArray<ProtoSkill> = [
  {
    slug: "william-draft-skill-md",
    name: "William Draft Skill Md",
    project: "skillmaker-studio",
    oneLiner: "Drafts output/SKILL.md from a bundle's design.md — the drafting station's default agent.",
    summary:
      "Hand it a bundle's design.md and it writes the actual skill file an agent will install and run. It is deliberately narrow: it will not research a topic from scratch, it will not write eval fixtures, and if design.md is still an empty scaffold it stops and says so rather than inventing a skill.",
    tags: ["meta", "stations"],
    stage: "Evals",
    versionShort: "a3f19c22",
    drift: "in sync",
    provenOn: "claude-opus-4-8",
    coverage: "3 of 7 risks",
    keyFiles: [
      { path: "output/SKILL.md", why: "What ships. The words an agent actually reads." },
      { path: "design.md", why: "Why it's shaped this way — the intent and the workflow." },
      { path: "evals/risk-map.md", why: "The ways it can go wrong, and which have a fixture." },
    ],
    files: DRAFT_FILES,
    contents: DRAFT_CONTENTS,
  },
  {
    slug: "william-research-a-skill",
    name: "William Research A Skill",
    project: "skillmaker-studio",
    oneLiner: "Researches a proposed skill and produces an approved design.md.",
    summary:
      "The step before drafting. It works out what a proposed skill has to survive and writes that down as design.md, so the drafting agent has something real to work from. Its output is a document for a human to approve, not a shippable skill.",
    tags: ["meta", "stations"],
    stage: "Drafting",
    versionShort: "7b40e1d5",
    drift: "edited since last version",
    provenOn: "none yet",
    coverage: "1 of 4 risks",
    keyFiles: [
      { path: "output/SKILL.md", why: "What ships." },
      { path: "design.md", why: "Why it's shaped this way." },
      { path: "research/notes.md", why: "What the research turned up." },
    ],
    files: RESEARCH_FILES,
    contents: RESEARCH_CONTENTS,
  },
  {
    slug: "release-notes",
    name: "Release Notes",
    project: "skillmaker-studio",
    oneLiner: "Writes release notes from a tag range, in the house voice.",
    summary:
      "Brand new — nothing but a scaffold so far. design.md still has its placeholder comments in it, which is exactly why the drafting station would refuse to run.",
    tags: ["ops"],
    stage: "Idea",
    versionShort: null,
    drift: "no version recorded",
    provenOn: "none yet",
    coverage: "no risk map yet",
    keyFiles: [{ path: "design.md", why: "Start here — it's still a scaffold." }],
    files: RELEASE_FILES,
    contents: RELEASE_CONTENTS,
  },
];

// ----------------------------------------------------------------- the work

/**
 * The Board, unchanged from sketch v0 in shape but re-grounded: a job now
 * names the FILE it produces, not an invented "block". Columns are work
 * states. This half of the argument still needs your ruling — the redo
 * brief was about the skill page, so I left it alone rather than quietly
 * redesigning it too.
 */
export const COLUMNS = ["Queued", "Running", "Needs you", "Landed"] as const;
export type Column = (typeof COLUMNS)[number];

export type Work = {
  readonly id: string;
  readonly title: string;
  readonly skill: string;
  readonly column: Column;
  /** Paths this job writes. The join between Board and folder. */
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
    detail: "Four fixture cases on claude-opus-4-8. Writes a transcript per run.",
    age: "running 4m",
  },
  {
    id: "w2",
    title: "Author a fixture for RE-1",
    skill: "william-draft-skill-md",
    column: "Queued",
    produces: ["evals/fixtures/revise-notes-honored/"],
    kind: "eval",
    detail: "RE-1 is a gap in the risk map: revise notes silently ignored. No fixture buys it yet.",
    age: "queued 1d",
  },
  {
    id: "w3",
    title: "Approve the drafted SKILL.md",
    skill: "william-research-a-skill",
    column: "Needs you",
    produces: ["output/SKILL.md"],
    kind: "review",
    detail: "The drafting station is holding at awaiting-review. It wants a human to look at the draft.",
    age: "waiting 2d",
  },
  {
    id: "w4",
    title: "Write design.md",
    skill: "release-notes",
    column: "Needs you",
    produces: ["design.md"],
    kind: "research",
    detail: "design.md is still the scaffold. Until Intent and The workflow have real content, drafting refuses to run.",
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
