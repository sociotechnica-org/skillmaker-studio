/**
 * Static placeholder dataset shaped by the domain types — the seam where
 * API wiring lands (each constant's consumer swaps to live data without
 * changing component shape).
 */
import type { Claim, Project, SkillPage, Task } from "./types.ts";

export const PROJECTS: ReadonlyArray<Project> = [
  {
    name: "skills",
    path: "~/Documents/code/skills",
    skills: [
      { slug: "to-tickets", stage: "Evals", oneLiner: "Decompose a decided scope into tracer-bullet tickets" },
      { slug: "release-notes", stage: "Idea", oneLiner: "Draft release notes from merged PRs" },
      { slug: "standup-summarizer", stage: "Idea", oneLiner: "Summarize the day across repos" },
      { slug: "pr-description-writer", stage: "Drafting", oneLiner: "Write PR descriptions from diffs" },
      { slug: "changelog-curator", stage: "Research", oneLiner: "Curate user-facing changelogs" },
      { slug: "incident-scribe", stage: "Idea", oneLiner: "Turn incident channels into postmortems" },
      { slug: "meeting-actions", stage: "Idea", oneLiner: "Extract action items from transcripts" },
    ],
  },
  {
    name: "skillmaker-studio",
    path: "~/Documents/code/skillmaker-studio",
    skills: [
      { slug: "skillmaker-dev-release", stage: "Published", oneLiner: "Cut a skillmaker-studio release" },
      { slug: "to-tickets", stage: "Published", oneLiner: "Decompose scope into tickets (installed)" },
    ],
  },
];

export const TASKS: ReadonlyArray<Task> = [
  { title: "IN-1 fixture may not force skill invocation — add trigger variant", origin: "run · to-tickets", state: "open" },
  { title: "Cover RE-2 (DAG validity) — no fixture yet", origin: "gap · to-tickets", state: "open" },
  { title: "Grow partial-decomposition past smoke (n=1 of 5)", origin: "gap · to-tickets", state: "open" },
  { title: "Permission denials review after first canary run", origin: "human", state: "in-progress" },
];

export const CLAIMS: ReadonlyArray<Claim> = [
  { id: "IN-1", family: "Input", sentence: "Input too vague to decompose: refuses and asks for concrete scope", status: "proven", fixtures: 1 },
  { id: "IN-2", family: "Input", sentence: "Already-partial decomposition is respected, not discarded", status: "unmeasured", fixtures: 1 },
  { id: "RE-1", family: "Reasoning", sentence: "Blocking edges are real — never merely-related", status: "partial", fixtures: 1 },
  { id: "RE-2", family: "Reasoning", sentence: "The DAG is valid: no cycles, no dangling references", status: "gap", fixtures: 0 },
  { id: "OUT-3", family: "Output", sentence: "Never talks to a tracker API", status: "gap", fixtures: 0 },
];

export const BUNDLE_FILES: ReadonlyArray<string> = [
  "design.md",
  "output/SKILL.md",
  "research/notes.md",
  "research/decisions.md",
  "evals/risk-map.md",
  "evals/fixtures/vague-scope-refusal/",
  "evals/fixtures/partial-decomposition/",
];

/** Placeholder Skill page until the API answers (or when it's absent). */
export const SKILL_PAGE: SkillPage = {
  instructions: "Decompose an already-decided scope into vertical-slice implementation tickets…",
  stage: "Evals",
  versionShort: "811e4580",
  drift: "in sync",
  provenOn: "Opus 4.6 (1 claim)",
  coverage: "2 of 5 claims",
  claims: CLAIMS,
  events: [
    { type: "run.graded", at: "yesterday" },
    { type: "station drafting completed", at: "2d ago" },
    { type: "bundle.created", at: "2d ago" },
  ],
};
