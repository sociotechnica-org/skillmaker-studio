/**
 * PROTOTYPE — the station vocabulary (parallelism pass, 2026-08-05).
 *
 * THE CHAIN, in the director's words: "we recommend generating file X,
 * using process Y, supported by an agent running skill Z." That chain is
 * already on disk — `stations.json` holds `produces` / `doer` / `skill`
 * per station. This module is where it gets said in words.
 *
 * ---------------------------------------------------------------------
 * THE PROBLEM THIS PASS SOLVES
 *
 * The stations are not parallel in KIND, and no set of five words can make
 * them so:
 *
 *   Job · Method · Draft   the work genuinely happens in the studio
 *   Proof                  we design and tune the strategy; the runs
 *                          happen in somebody else's playground
 *   Release                it is published and made live elsewhere,
 *                          probably by their flow — we need to KNOW it's
 *                          live and stay on top of the version, but we
 *                          are not the ones doing it
 *
 * Gerunds hid this ("Proving", "Releasing" both claim acts we don't
 * perform). Bare imperatives hide it too, and worse: "Prove" and "Release"
 * read as instructions to go do a thing this product cannot do.
 *
 * So: STOP ENCODING MODE IN THE NAME. Name every station with a NOUN — the
 * thing being made or managed — which IS parallel across all five. Then
 * carry the mode as its own honest field, and show it. The asymmetry
 * becomes information the maker can read, instead of a lie in a label or a
 * wobble in the grammar.
 *
 * Nouns also dodge the -ing problem entirely, which the director dislikes.
 *
 * ---------------------------------------------------------------------
 * WHY A RENAME IS CHEAP. The wire literals (`idea`, `researching`,
 * `drafting`, `evaluating`, `published`) are the journal format and the
 * `--json` contract — they must not move. Display labels are already a
 * separate layer, in THREE maps that have quietly drifted apart:
 *
 *   cli/src/StageVocab.ts          Idea · Research · Draft    · Evals · Publish
 *   viewer/next/api.ts             Idea · Research · Drafting · Evals · Published
 *   viewer/runtime/schemas.ts      (a third mirror)
 *
 * A rename is one edit per map. This file is proposed as the ONE that
 * replaces all three.
 */

/** The wire literals. NEVER renamed — journal format and `--json` contract. */
export const WIRE_STAGES = ["idea", "researching", "drafting", "evaluating", "published"] as const;
export type WireStage = (typeof WIRE_STAGES)[number];

/**
 * Where the work actually happens. The whole point of this pass: the
 * studio does three different KINDS of thing, and pretending otherwise is
 * what made "Evals" and "Published" feel wrong.
 */
export type Mode = "made-here" | "planned-here" | "elsewhere";

export const MODE_LABEL: Record<Mode, string> = {
  "made-here": "made here",
  "planned-here": "planned here · run elsewhere",
  elsewhere: "happens elsewhere · tracked here",
};

export type Station = {
  readonly wire: WireStage;
  /** What the shipping app calls it today. Kept so the diff stays legible. */
  readonly was: string;
  /** The proposed name: a NOUN — the thing made or managed. */
  readonly name: string;
  /** The one question this station exists to answer. */
  readonly question: string;
  /** What it leaves behind — the "file X" of the chain. */
  readonly makes: string;
  readonly mode: Mode;
  /** Other names considered, and why they lost or might still win. */
  readonly alternates: string;
};

export const STATIONS: ReadonlyArray<Station> = [
  {
    wire: "idea",
    was: "Idea",
    name: "Job",
    question: "What is this for?",
    makes: "dossier.md",
    mode: "made-here",
    // "Idea" named a feeling, not a piece of work, and nothing about it
    // said a file came out. This is the skill's job to be done -- purpose
    // and context of use -- which is exactly the dossier's ruled sections.
    // "Purpose" was the runner-up but drifts back toward floaty; "Job" is
    // the director's own phrase, shortened, and it's concrete.
    alternates: "Purpose · Brief · Scope",
  },
  {
    wire: "researching",
    was: "Research",
    name: "Method",
    question: "How should it be done?",
    makes: "design.md",
    mode: "made-here",
    // "Research" is one WAY of answering this question, and plenty of
    // makers answer it by fiat instead -- "just do it this way" is a
    // complete answer, not a skipped step. "Method" covers both, and it's
    // the director's own word. This is also where the play diagram lived
    // in Playmaker. Still the fuzziest station: see OPEN_METHOD below.
    alternates: "Process · Approach · Play",
  },
  {
    wire: "drafting",
    was: "Drafting",
    name: "Draft",
    question: "How do we say it to the model?",
    makes: "output/SKILL.md",
    mode: "made-here",
    // Prompt and context engineering, aimed at a specific model. "Prompt"
    // is more precise about the craft but narrower than the artifact -- a
    // skill is also references, scripts, examples. See MODEL_SELECTION:
    // this is the LATEST the model can be chosen, and nothing records it.
    alternates: "Prompt · Copy · Words",
  },
  {
    wire: "evaluating",
    was: "Evals",
    name: "Proof",
    question: "How will we know it worked?",
    makes: "evals/risk-map.md · evals/fixtures/",
    mode: "planned-here",
    // "Evals" promised a playground we are not. The noun fixes what the
    // gerund couldn't: "Proof" is the ARTIFACT -- the strategy, the risks
    // that matter, the fixture that buys each one. Designing and tuning it
    // is studio work. Running it is not.
    alternates: "Trials · Checks · Test plan · Evidence",
  },
  {
    wire: "published",
    was: "Published",
    name: "Release",
    question: "Where is it now, and is it current?",
    makes: "a recorded version + where it's installed",
    mode: "elsewhere",
    // Note the question changed. It used to be "where does it go to run?",
    // which implied we send it. We don't: it's published and made live by
    // somebody else's flow. What we owe the maker is KNOWING -- is it live,
    // at which version, has it drifted. That's tracking, and the noun
    // "Release" names the thing tracked rather than an act we perform.
    // "Provenance" is the team's existing word (Mechanism - Provenance
    // Stamp) and is more precise, but it's long and jargon-y for a column.
    alternates: "Provenance · Record · Standing · In the wild",
  },
];

export const STATION_BY_WIRE: Record<WireStage, Station> = Object.fromEntries(
  STATIONS.map((s) => [s.wire, s] as const),
) as Record<WireStage, Station>;

/**
 * MADE / TO BE MADE (director ruling, 2026-08-05): "the product needs to
 * speak to MAKING in the board and then show MADE or needs to be MADE in
 * the skill's baseball card / folders."
 */
export const MADE = "made";
export const TO_BE_MADE = "to be made";

/**
 * OPEN RULING — model selection. Today the honest answer is NOBODY
 * DECIDES, and nothing records it:
 *
 *   · `bundle.json.targets` is documented as "which AGENTS the skill is
 *     written for (e.g. claude-code)" (core/src/Bundle.ts:44) — a runtime,
 *     not a model.
 *   · the chat panel's ModelPicker chooses per SESSION.
 *   · an eval run records the model it happened to use, per RUN.
 *
 * So a skill can be written against Opus, proved on Sonnet and published
 * with neither fact attached to it. A data-model gap, not a labelling one.
 */
export const MODEL_SELECTION_IS_UNRECORDED = true;

/**
 * OPEN RULING — what Method holds. Two different things want that bench:
 * grounding (research, best practice, your organisation's way) and
 * structure (the diagram: sequence, branch points, where you fight the
 * model versus go with it). And for reactive skills there may be no
 * sequence to draw at all. One bench or two is not settled.
 */
export const OPEN_METHOD = "grounding + structure: one station or two?";
