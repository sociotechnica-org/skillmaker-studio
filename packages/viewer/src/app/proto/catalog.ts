/**
 * PROTOTYPE — the block catalog (usability remodel, 2026-08-05).
 *
 * The thesis in one line: **a block IS a file.** The skill card is not a
 * dashboard sitting next to the folder tree — it is the folder tree, drawn
 * as an object you can read. Every block on the card names a real path in
 * the bundle. A filled block means that file exists. A blank block means
 * that file COULD exist and doesn't yet — which is exactly a piece of work
 * someone hasn't done.
 *
 * That gives the three nouns one spine:
 *
 *   folder  →  the drawer a block lives in (output / research / evals / runs)
 *   block   →  a file, and the thing you look at
 *   work    →  what turns a blank block into a filled one (a Board card)
 *
 * So "where does work happen?" has a real answer: the Board. And "what am
 * I looking at?" has one too: the card, which is the outputs of that work.
 *
 * Squarespace rule (the director's ask): the catalog SHOWS THE POSSIBLE.
 * Everything below can be on a card; almost nothing has to be. Blocks are
 * addable, removable, and reorderable, and the ones nobody filled in still
 * advertise themselves as gray wells rather than hiding.
 */

/** The bundle's real directories — the card's drawers. */
export const FOLDERS = ["output", "research", "evals", "runs", "record"] as const;
export type Folder = (typeof FOLDERS)[number];

export const FOLDER_LABEL: Record<Folder, string> = {
  output: "output/",
  research: "research/",
  evals: "evals/",
  runs: "runs/",
  record: "the record",
};

/** What a drawer is FOR — shown when you open it, so the folder has a job. */
export const FOLDER_JOB: Record<Folder, string> = {
  output: "What ships. An agent reads only this.",
  research: "Why it's shaped this way. Nothing here ships.",
  evals: "What we claim, and the fixtures that hold us to it.",
  runs: "What actually happened when we ran it.",
  record: "Who did what, when — and where it's installed.",
};

/** How a filled block draws itself. Six primitives cover the whole catalog. */
export type BlockRender = "prose" | "list" | "files" | "stat" | "heat" | "table" | "lineage";

/** Grid width, in columns of six. */
export type Span = 2 | 3 | 6;

export type BlockSpec = {
  readonly id: string;
  readonly label: string;
  readonly folder: Folder;
  /** The path this block IS. `…` marks a directory of many files. */
  readonly path: string;
  /** Shown inside the blank well: what would go here, in the maker's words. */
  readonly blurb: string;
  /** The Board card this block mints when you say "start this work". */
  readonly work: string;
  /** Core blocks can't be removed — without them there is no skill. */
  readonly core?: boolean;
  readonly render: BlockRender;
  readonly span: Span;
};

export const CATALOG: ReadonlyArray<BlockSpec> = [
  // ---------------------------------------------------------------- output
  {
    id: "instructions",
    label: "Instructions",
    folder: "output",
    path: "output/SKILL.md",
    blurb: "The skill itself — the words an agent actually reads.",
    work: "Draft SKILL.md",
    core: true,
    render: "prose",
    span: 6,
  },
  {
    id: "trigger",
    label: "Trigger",
    folder: "output",
    path: "output/SKILL.md · frontmatter",
    blurb: "The one line that decides whether an agent reaches for this at all.",
    work: "Write the trigger line",
    core: true,
    render: "prose",
    span: 3,
  },
  {
    id: "scope",
    label: "Job & scope",
    folder: "output",
    path: "output/SKILL.md · §scope",
    blurb: "What it does, what it refuses to do, and how you'd know it fit.",
    work: "Pin down scope",
    render: "list",
    span: 3,
  },
  {
    id: "references",
    label: "Reference material",
    folder: "output",
    path: "output/references/…",
    blurb: "Prior art the agent should read but you don't want inline.",
    work: "Gather reference material",
    render: "files",
    span: 3,
  },
  {
    id: "scripts",
    label: "Scripts",
    folder: "output",
    path: "output/scripts/…",
    blurb: "Executables the skill shells out to instead of describing in prose.",
    work: "Write a helper script",
    render: "files",
    span: 3,
  },
  {
    id: "examples",
    label: "Worked examples",
    folder: "output",
    path: "output/examples/…",
    blurb: "One good run, written down. Cheapest quality lever there is.",
    work: "Capture a worked example",
    render: "files",
    span: 3,
  },

  // -------------------------------------------------------------- research
  {
    id: "design",
    label: "Design rationale",
    folder: "research",
    path: "research/design.md",
    blurb: "Why this shape and not another. The thing future-you will want.",
    work: "Write the design note",
    render: "prose",
    span: 6,
  },
  {
    id: "notes",
    label: "Research notes",
    folder: "research",
    path: "research/notes.md",
    blurb: "What you found while figuring out what this should be.",
    work: "Run the research station",
    render: "prose",
    span: 3,
  },
  {
    id: "sources",
    label: "Sources",
    folder: "research",
    path: "research/sources/…",
    blurb: "The corpus this was built from, kept so the claims stay checkable.",
    work: "Collect sources",
    render: "files",
    span: 3,
  },
  {
    id: "decisions",
    label: "Decisions",
    folder: "research",
    path: "research/decisions.md",
    blurb: "The forks in the road, and which way you went.",
    work: "Record the decisions",
    render: "list",
    span: 3,
  },
  {
    id: "failures",
    label: "Failure hypotheses",
    folder: "research",
    path: "research/failure-modes.md",
    blurb: "The known ways this goes wrong. Each one wants a fixture.",
    work: "List the failure modes",
    render: "list",
    span: 3,
  },
  {
    id: "pipeline",
    label: "Pipeline",
    folder: "research",
    path: "research/design.md · §pipeline",
    blurb: "What hands work to this skill, and what it hands off.",
    work: "Map the pipeline",
    render: "list",
    span: 6,
  },

  // ----------------------------------------------------------------- evals
  {
    id: "claims",
    label: "Claims",
    folder: "evals",
    path: "evals/claims.md",
    blurb: "The sentences you're willing to be held to.",
    work: "State the claims",
    render: "list",
    span: 3,
  },
  {
    id: "fixtures",
    label: "Fixtures",
    folder: "evals",
    path: "evals/fixtures/…",
    blurb: "The cases that hold the claims up. No fixture, no claim.",
    work: "Author a fixture",
    render: "files",
    span: 3,
  },
  {
    id: "risk",
    label: "Risk heat map",
    folder: "evals",
    path: "evals/ · derived",
    blurb: "Every way this can go wrong, lit by how little you've looked.",
    work: "Map the risks",
    render: "heat",
    span: 6,
  },
  {
    id: "adversarial",
    label: "Adversarial cases",
    folder: "evals",
    path: "evals/fixtures/adversarial/…",
    blurb: "The cases built from what actually burned you.",
    work: "Add an adversarial case",
    render: "files",
    span: 3,
  },
  {
    id: "coverage",
    label: "Coverage",
    folder: "evals",
    path: "evals/ · derived",
    blurb: "How much of what you claim is actually measured.",
    work: "Close the gaps",
    render: "stat",
    span: 3,
  },

  // ------------------------------------------------------------------ runs
  {
    id: "models",
    label: "Model performance",
    folder: "runs",
    path: "runs/ · derived",
    blurb: "Pass rate, latency and cost, per model. The buy/sell page.",
    work: "Split-test a model",
    render: "table",
    span: 6,
  },
  {
    id: "passrate",
    label: "Pass rate",
    folder: "runs",
    path: "runs/ · derived",
    blurb: "The headline number, pinned to a version and a model.",
    work: "Run the fixtures",
    render: "stat",
    span: 2,
  },
  {
    id: "latency",
    label: "Latency",
    folder: "runs",
    path: "runs/ · derived",
    blurb: "How long a real invocation takes.",
    work: "Measure latency",
    render: "stat",
    span: 2,
  },
  {
    id: "cost",
    label: "Cost",
    folder: "runs",
    path: "runs/ · derived",
    blurb: "What one run costs you, relative to the baseline model.",
    work: "Measure cost",
    render: "stat",
    span: 2,
  },
  {
    id: "history",
    label: "Run history",
    folder: "runs",
    path: "runs/…",
    blurb: "Every invocation, kept. The transcript is the evidence.",
    work: "Run the fixtures",
    render: "files",
    span: 6,
  },

  // ---------------------------------------------------------------- record
  {
    id: "versions",
    label: "Versions",
    folder: "record",
    path: ".skillmaker/versions/…",
    blurb: "Every recorded state, with a hash you can go back to.",
    work: "Record a version",
    render: "list",
    span: 3,
  },
  {
    id: "lineage",
    label: "Family",
    folder: "record",
    path: ".skillmaker/lineage",
    blurb: "What this was forked from, and what's been forked off it.",
    work: "Fork it",
    render: "lineage",
    span: 3,
  },
  {
    id: "custody",
    label: "Chain of custody",
    folder: "record",
    path: ".skillmaker/journal",
    blurb: "Who touched it, when, and who approved.",
    work: "Request a review",
    render: "list",
    span: 3,
  },
  {
    id: "install",
    label: "Installed at",
    folder: "record",
    path: ".skillmaker/publish",
    blurb: "Where the published copy lives, and whether it has drifted.",
    work: "Publish it",
    render: "stat",
    span: 3,
  },
];

export const SPEC: Record<string, BlockSpec> = Object.fromEntries(CATALOG.map((b) => [b.id, b]));

/** The default card: what a new skill starts with before anyone edits it. */
export const DEFAULT_LAYOUT: ReadonlyArray<string> = CATALOG.map((b) => b.id);
