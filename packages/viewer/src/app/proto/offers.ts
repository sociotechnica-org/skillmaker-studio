/**
 * PROTOTYPE — offers, desire, and readiness (2026-08-05).
 *
 * THE RULING THIS IMPLEMENTS. Director: "It's not just about toggling
 * something OFF, it's about toggling it ON... I'm clicking the green
 * button — I want to BUILD this piece. Tracking missing things isn't
 * helpful because missing may not be desired. The key thing to track is
 * DESIRED. And sometimes desired can't fire yet: I desire evals, but
 * they're blocked by Job or Method."
 *
 * So a blank is not a hole in a checklist. It has three states, and the
 * product only ever counts the middle one:
 *
 *   offered    the product left room here. Costs nothing, means nothing.
 *   wanted     the maker said "build this." THIS is the trackable fact.
 *   cleared    the maker said "not how I work." Gone, reversibly.
 *
 * And a wanted thing is not automatically actionable, which is the part a
 * plain to-do list gets wrong:
 *
 *   blocked    wanted, but something it's made FROM doesn't exist yet
 *   ready      wanted, and everything it needs is in place → it can fire
 *
 * Readiness is derived, never stored. You declare desire once; the graph
 * decides when it can happen.
 *
 * THE DEPENDENCIES ARE REAL, not invented for the demo. They're enforced
 * by the skills themselves — william-draft-skill-md's own SKILL.md says:
 * "Read design.md in the current directory. If it does not exist... stop,
 * write nothing. A fabricated skill is worse than no skill." That's a hard
 * precondition living in the product already; this file just reads it out
 * loud so a maker can see WHY something can't fire yet.
 */

export type PieceName = "Job" | "Method" | "Prompt" | "Evals";

/* The dossier.md offer was removed 2026-08-08: `skillmaker dossier` no
   longer exists and nothing scaffolds the file, so offering to make it
   would be offering work the product can't do. */

export type Offer = {
  /** The file this offer would bring into being. Also its identity. */
  readonly path: string;
  readonly piece: PieceName;
  /** One line: what this file is. */
  readonly why: string;
  /** What fills it — the process, in the maker's words. */
  readonly how: string;
  /**
   * Paths that must exist first. Empty = can fire the moment it's wanted.
   * Each is a real precondition, not a taste.
   */
  readonly needs: ReadonlyArray<string>;
  /** Why the precondition exists, shown when this is blocked. */
  readonly needsBecause: string | null;
  /**
   * The station that would do it, from `stations.json`'s `doer`/`skill`.
   * Null where no station claims the file — an honest gap in the wiring,
   * not a thing to invent.
   */
  readonly station: string | null;
};

export const OFFERS: ReadonlyArray<Offer> = [
  {
    path: "design.md",
    piece: "Method",
    why: "Intent and workflow — how this skill is meant to work.",
    how: "The researching station drafts it, or write it by hand.",
    needs: [],
    needsBecause: null,
    station: "researching · william-research-a-skill",
  },
  {
    path: "output/SKILL.md",
    piece: "Prompt",
    why: "What ships. The words an agent actually reads.",
    how: "The drafting station writes it from design.md.",
    needs: ["design.md"],
    needsBecause:
      "The drafting skill refuses without it: “If design.md does not exist, or its Intent and workflow sections are empty — stop, write nothing. A fabricated skill is worse than no skill.”",
    station: "drafting · william-draft-skill-md",
  },
  {
    path: "evals/risk-map.md",
    piece: "Evals",
    why: "The ways it can go wrong, and which ones a fixture covers.",
    how: "The evaluating station authors it once there's a draft to evaluate.",
    needs: ["output/SKILL.md"],
    needsBecause: "There is nothing to map risks against until a prompt exists.",
    station: "evaluating",
  },
];

export const OFFER_BY_PATH: Readonly<Record<string, Offer>> = Object.fromEntries(OFFERS.map((o) => [o.path, o]));

// ------------------------------------------------------------ the states

export type OfferState = "offered" | "wanted" | "cleared";

/** A wanted offer, resolved against what actually exists on disk. */
export type Wanted = {
  readonly offer: Offer;
  /** Paths it's waiting on that don't exist yet. Empty = ready to fire. */
  readonly missing: ReadonlyArray<string>;
};

export const isReady = (w: Wanted): boolean => w.missing.length === 0;

/** What a wanted offer is still waiting for, given the paths that exist. */
export const missingFor = (offer: Offer, have: ReadonlySet<string>): ReadonlyArray<string> =>
  offer.needs.filter((n) => !have.has(n));

// ------------------------------------------------------------- the store

/**
 * Desire and refusal, per skill. localStorage is the prototype's
 * expedient; the real home is the bundle, so "we don't do evals here" and
 * "we want evals next" both travel in git with the skill rather than
 * living in one person's browser.
 */
export type Marks = Readonly<Record<string, OfferState>>;

const KEY = (slug: string) => `sm-proto-marks-${slug}`;

export const readMarks = (slug: string): Marks => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY(slug));
    return raw === null ? {} : (JSON.parse(raw) as Marks);
  } catch {
    return {};
  }
};

export const writeMarks = (slug: string, marks: Marks): void => {
  try {
    window.localStorage.setItem(KEY(slug), JSON.stringify(marks));
  } catch {}
};

/** Every skill slug that currently has any mark — Tasks reads across all. */
export const markedSlugs = (): ReadonlyArray<string> => {
  if (typeof window === "undefined") return [];
  const out: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k !== null && k.startsWith("sm-proto-marks-")) out.push(k.replace("sm-proto-marks-", ""));
    }
  } catch {}
  return out;
};
