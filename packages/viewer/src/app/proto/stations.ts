/**
 * PROTOTYPE — the station vocabulary (naming pass, 2026-08-05).
 *
 * THE CHAIN, in the director's words: "we recommend generating file X,
 * using process Y, supported by an agent running skill Z."
 *
 * That chain is already on disk. `stations.json` has held it all along:
 *
 *   "drafting": { "produces": ["design.md", "output/SKILL.md"],   ← file X
 *                 "doer": "agent",                                ← process Y
 *                 "skill": "william-draft-skill-md",              ← skill Z
 *                 "review": true }
 *
 * So the Board's columns are not kanban states. Each one is a STATION: a
 * bench where a named thing gets made, by a named process, optionally with
 * an agent. This module is where that gets said in words.
 *
 * WHY A RENAME IS CHEAP. The wire literals (`idea`, `researching`,
 * `drafting`, `evaluating`, `published`) are the journal format and the
 * `--json` contract — they must not move. Display labels are already a
 * separate layer, in THREE maps that have quietly drifted apart:
 *
 *   cli/src/StageVocab.ts          Idea · Research · Draft    · Evals · Publish
 *   viewer/next/api.ts             Idea · Research · Drafting · Evals · Published
 *   viewer/runtime/schemas.ts      (a third mirror)
 *
 * A rename is one edit per map. This file is the prototype's fourth — and
 * the proposal is that it becomes the ONE, with the others deleted.
 *
 * ---------------------------------------------------------------------
 * THE PROPOSAL. Five making-acts, each answering one question and leaving
 * one artifact behind. Present participles throughout, because a station
 * is an act in progress, not a state a card sits in.
 *
 * Alternates worth arguing about are recorded per station in `alternates`.
 * Overruling any name is a one-line change here.
 */

/** The wire literals. NEVER renamed — journal format and `--json` contract. */
export const WIRE_STAGES = ["idea", "researching", "drafting", "evaluating", "published"] as const;
export type WireStage = (typeof WIRE_STAGES)[number];

export type Station = {
  readonly wire: WireStage;
  /** What the shipping app calls it today. Kept so the diff is legible. */
  readonly was: string;
  /** The proposed name: a making-act. */
  readonly name: string;
  /** The one question this station exists to answer. */
  readonly question: string;
  /** What it leaves behind — the "file X" of the chain. */
  readonly makes: string;
  /** Other names considered, and why they lost or might still win. */
  readonly alternates: string;
};

export const STATIONS: ReadonlyArray<Station> = [
  {
    wire: "idea",
    was: "Idea",
    name: "Framing",
    question: "What is this for?",
    makes: "dossier.md",
    // "Idea" is floaty: it names a feeling, not a piece of work, and nothing
    // about it says a file comes out. The work here is the skill's job to be
    // done -- purpose and context of use -- which is exactly the dossier's
    // ruled sections (Job, Contexts, Out-of-scope). "Job" was the runner-up
    // and is arguably plainer; "Framing" won because it's an act.
    alternates: "Job · Purpose · Scoping",
  },
  {
    wire: "researching",
    was: "Research",
    name: "Mapping",
    question: "How should it be done?",
    makes: "design.md",
    // "Research" is too narrow. Research is ONE way to answer this question
    // and plenty of makers skip it -- "just do it this way" is a legitimate
    // and complete answer. The station is about METHOD: your organisation's
    // way, or best practice, or simply where you intend to fight the model
    // versus go with it. Playmaker's play diagram lived here.
    alternates: "Method · Designing · Planning (clashes with the product's own framing)",
  },
  {
    wire: "drafting",
    was: "Drafting",
    name: "Writing",
    question: "How do we say it to the model?",
    makes: "output/SKILL.md",
    // The one station whose old name was roughly honest. "Writing" says the
    // craft out loud -- prompt and context engineering, aimed at a specific
    // model. See MODEL_SELECTION below: this is the LATEST the model can be
    // chosen, and today nothing records that choice at all.
    alternates: "Drafting · Authoring · Prompting",
  },
  {
    wire: "evaluating",
    was: "Evals",
    name: "Proving",
    question: "How will we know it worked?",
    makes: "evals/risk-map.md · evals/fixtures/",
    // "Evals" is the worst offender: it promises a playground we are not.
    // The work here is DESIGNING the testing strategy -- which risks matter,
    // which fixture buys which risk. Running them happens elsewhere.
    // "Proving" keeps both useful senses: dough proving (preparing) and a
    // printer's proof (checking before the press run). Both are making
    // words, neither claims a test runner. "Hardening" is the team's own
    // word for the same path and is a live contender.
    alternates: "Hardening · Proofing · Test plan · Evidence",
  },
  {
    wire: "published",
    was: "Published",
    name: "Releasing",
    question: "Where does it go to run?",
    makes: "a recorded version, installed",
    // Same honesty problem as Evals, milder: we don't host the skill, we
    // hand it off. "Releasing" is the act we actually perform -- record a
    // version, write it where an agent reads.
    alternates: "Handoff · Shipping · Installing",
  },
];

export const STATION_BY_WIRE: Record<WireStage, Station> = Object.fromEntries(
  STATIONS.map((s) => [s.wire, s] as const),
) as Record<WireStage, Station>;

/**
 * MADE / TO BE MADE (director ruling, 2026-08-05): "the product needs to
 * speak to MAKING in the board and then show MADE or needs to be MADE in
 * the skill's baseball card / folders."
 *
 * So the two surfaces use two halves of one verb. The Board is present
 * participles (Framing, Mapping, …) — work under way. The skill page is
 * past participle versus future — what exists and what doesn't.
 */
export const MADE = "made";
export const TO_BE_MADE = "to be made";

/**
 * OPEN RULING — model selection. The director: "When does model selection
 * happen in this process? Who decides and how? That needs to happen at the
 * very latest here [Writing]."
 *
 * Today the honest answer is NOBODY DECIDES, and nothing records it:
 *
 *   · `bundle.json.targets` is documented as "which AGENTS the skill is
 *     written for (e.g. claude-code)" (core/src/Bundle.ts:44) — a runtime,
 *     not a model.
 *   · the chat panel's ModelPicker chooses per SESSION.
 *   · an eval run records the model it happened to use, per RUN.
 *
 * So a skill can be written against Opus, proved on Sonnet and published
 * with neither fact attached to it. There is no field to put the answer in.
 * That's a data-model gap, not a labelling one — flagged here rather than
 * papered over with a word.
 */
export const MODEL_SELECTION_IS_UNRECORDED = true;
