/**
 * PROTOTYPE — the pieces of a skill (2026-08-05).
 *
 * This file used to be `stations.ts`, and the rename IS the idea. Director:
 * "Job and method are not talking about what we're doing, they're talking
 * about what it IS." A station is a place work happens. A piece is a part
 * of the thing. We were naming benches when we should have been naming
 * parts, which is why nothing lined up.
 *
 * ---------------------------------------------------------------------
 * A SKILL HAS FOUR PIECES
 *
 *   Job      what you're trying to do
 *   Method   how you're trying to do it
 *   Prompt   the "coding" that makes it happen in agent world
 *   Evals    how you find out whether it worked
 *
 * That's the bundle, and it's the core of the lifecycle. Three of these
 * were previously named as ACTS (Idea, Research, Drafting). "Draft" was the
 * last holdout and it broke for the reason the director gave: you can draft
 * anything, and at some point you stop drafting. The thing you were
 * drafting is the Prompt. Name the part, not the verb.
 *
 * ---------------------------------------------------------------------
 * THE CUT THAT ACTUALLY MATTERS
 *
 * Not "where does the work happen" (the previous pass's guess) but WHERE
 * DOES THE PIECE GO:
 *
 *   Job, Method     stay here. They never go anywhere. Their whole job is
 *                   to INFORM the other two.
 *   Prompt, Evals   go off somewhere and run. The prompt runs in an agent;
 *                   the evals run in somebody else's playground.
 *
 * Two inward pieces, two outward pieces. That's the congruity the five
 * "stations" never had — and it's why Publish kept refusing to line up.
 *
 * ---------------------------------------------------------------------
 * PUBLISH IS NOT A FIFTH PIECE
 *
 * It's a STATUS on the two that leave: what's live, where, at what version
 * — and, the director's sharper version of the question, which EVALS are
 * live where, and how did they do? One layer asking the same question of
 * both outward pieces, not a peer sitting in a column.
 *
 * Deliberately left unresolved (see `RELEASE.unresolved`): we can't answer
 * "how'd it do" yet, because the results live in the playground we don't
 * run. The slot is drawn empty rather than faked.
 *
 * ---------------------------------------------------------------------
 * THE BET, recorded so it can be checked later. Director: "the first two
 * parts we think are important and we make sure we have, but we need to
 * find out whether the market finds it valuable." Job and Method are the
 * product's opinion — that a skill is worth more when its purpose and its
 * method are written down. Prompt and Evals are table stakes nobody argues
 * with. If the bet is wrong, the two inward pieces are the ones that go.
 */

/** The wire literals. NEVER renamed — journal format and `--json` contract. */
export const WIRE_STAGES = ["idea", "researching", "drafting", "evaluating", "published"] as const;
export type WireStage = (typeof WIRE_STAGES)[number];

/** Inward pieces inform; outward pieces leave and run. */
export type Group = "informs" | "ships";

export const GROUP_TITLE: Record<Group, string> = {
  informs: "What it is",
  ships: "What goes out",
};

export const GROUP_LABEL: Record<Group, string> = {
  informs: "stays here · informs the other two",
  ships: "leaves here · runs somewhere else",
};

/** One hue per group, from the brand's semantic ramp (teal / gold). */
export const GROUP_TINT: Record<Group, string> = {
  informs: "bg-sky-100 text-sky-800",
  ships: "bg-amber-100 text-amber-800",
};

export const GROUP_EDGE: Record<Group, string> = {
  informs: "border-sky-300/60",
  ships: "border-amber-300/70",
};

export type Piece = {
  readonly wire: WireStage;
  /** What the shipping app calls it today, so the diff stays legible. */
  readonly was: string;
  readonly name: string;
  /** What this piece IS — a definition, not an instruction. */
  readonly is: string;
  /** Where it's written down — the "file X" of the chain. */
  readonly makes: string;
  readonly group: Group;
  readonly alternates: string;
};

export const PIECES: ReadonlyArray<Piece> = [
  {
    wire: "idea",
    was: "Idea",
    name: "Job",
    is: "what you're trying to do",
    makes: "dossier.md",
    group: "informs",
    alternates: "Purpose · Brief",
  },
  {
    wire: "researching",
    was: "Research",
    name: "Method",
    is: "how you're trying to do it",
    makes: "design.md",
    group: "informs",
    // Still the fuzziest piece: grounding (research, best practice, your
    // organisation's way) and structure (the diagram — sequence, branch
    // points, where you fight the model versus go with it) both want to
    // live here, and reactive skills have no sequence to draw. See
    // OPEN_METHOD.
    alternates: "Process · Approach · Play",
  },
  {
    wire: "drafting",
    was: "Drafting",
    name: "Prompt",
    is: "the coding that makes it happen in agent world",
    makes: "output/SKILL.md",
    group: "ships",
    // Honest caveat kept from the last pass: a skill is also references,
    // scripts and examples, so "Prompt" is slightly narrower than the
    // artifact. It wins anyway because it names the part rather than the
    // act, which is the point of this pass.
    alternates: "Skill file · Instructions · Copy",
  },
  {
    wire: "evaluating",
    was: "Evals",
    name: "Evals",
    is: "how you find out whether it worked",
    makes: "evals/risk-map.md · evals/fixtures/",
    group: "ships",
    // Survives under its own name now. The old objection was that "Evals"
    // promised a playground we aren't -- but that was about MODE, and mode
    // is now carried by the group, not the word. Designing them is ours;
    // running them isn't. Exactly like the Prompt, which we also write here
    // and don't run here.
    alternates: "Proof · Trials · Checks",
  },
];

export const PIECE_BY_WIRE: Partial<Record<WireStage, Piece>> = Object.fromEntries(
  PIECES.map((p) => [p.wire, p] as const),
);

export const piecesIn = (group: Group): ReadonlyArray<Piece> => PIECES.filter((p) => p.group === group);

/**
 * Not a piece. A status layer over the two that leave, asking one question
 * of each. `published` has no column of its own any more: a skill whose
 * prompt is live is still a skill with four pieces — "live" is a fact about
 * its Prompt, not a fifth part of it.
 */
export const RELEASE = {
  name: "Release",
  is: "not a piece — what's true about the two that left",
  asks: [
    "Is the prompt live, where, and at what version?",
    "Which evals are live where — and how did they do?",
  ] as const,
  unresolved:
    "We can't answer “how did they do” yet: those results live in the playground we don't run. Importing them is the open Switzerland problem, so the slot is drawn empty rather than faked.",
} as const;

/** The board speaks to making; the skill page shows made / to be made. */
export const MADE = "made";
export const TO_BE_MADE = "to be made";

/**
 * OPEN RULING — model selection. Nothing records a skill's intended model:
 * `bundle.json.targets` is agents-not-models by its own doc comment
 * (core/src/Bundle.ts:44), the ModelPicker chooses per session, and a run
 * records whatever it happened to use. A skill can be written against Opus,
 * evaluated on Sonnet and published with neither fact attached. Under this
 * model the answer has an obvious home: the model is a property of the
 * PROMPT, decided no later than when the prompt is written.
 */
export const MODEL_SELECTION_IS_UNRECORDED = true;

/** OPEN RULING — does Method hold grounding and structure, or split in two? */
export const OPEN_METHOD = "grounding + structure: one piece or two?";

/**
 * RULING — A BLANK IS AN OFFER, NOT A DEFICIENCY (2026-08-05).
 *
 * Director: "What bugs me most about having any kind of missing count is
 * that the maker may not care. They may be missing something intentionally
 * because their process doesn't use it... Having examples to change and
 * reshape or templates to work with = good. Forcing a method = bad."
 *
 * So: no gap counts, no progress meters, no totals anywhere on the card. A
 * skill with three of four pieces empty is not 25% complete — it may be
 * finished. What a blank gets instead is empty space, an instruction for
 * filling it, and a ✕ for declining it, exactly like a website builder.
 *
 * Declining is reversible and, in the real thing, belongs in the bundle
 * rather than in localStorage: "we don't do evals here" is a fact about the
 * skill that should travel in git, not a fact about one person's browser.
 *
 * WHERE THIS GOES NEXT (director, same ruling): "We know that a missing
 * piece = a work order = an agent activating a skill. We can map those and
 * then add in triggers + explainers in empty spaces to make them more
 * actionable."
 *
 * That is the causal chain the whole product turns on, and it's already
 * half-built: `stations.json` maps produces → doer → skill, which is
 * exactly "this blank, filled by this agent, running this skill." Empty
 * space becomes a button that starts real work, and the three states of a
 * blank become: offered · declined · running. What's missing today is only
 * the join between a named blank and the station that fills it.
 *
 * NOT built yet, deliberately: templates and worked examples. The director:
 * "We haven't earned templates and examples yet, but empty space and
 * instructions on how to fill it will be fine."
 */
export const BLANKS_ARE_OFFERS = true;
