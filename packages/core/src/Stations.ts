/**
 * `skills/<slug>/stations.json` — per-bundle work config (source class),
 * copied — not referenced — from an app-level template at `skillmaker new`
 * (data-model.md §2.13).
 */
import { Schema } from "effect";

/** [inherited: doer honesty] — who does a station's work. */
export const StationDoer = Schema.Literals(["agent", "human"]);
export type StationDoer = typeof StationDoer.Type;

export class Station extends Schema.Class<Station>("Station")({
  doer: StationDoer,
  /** The skill the station-agent runs with, e.g. "william-research-a-skill". */
  skill: Schema.optionalKey(Schema.String),
  /** Paths (relative to the bundle) this station's work produces. Controls BOTH sandbox seeding and copyback (StationEngine.ts's `filterToProduces`). */
  produces: Schema.Array(Schema.String),
  /**
   * Paths (relative to the bundle) seeded INTO the station's sandbox as
   * read-only upstream context, but never copied back — copyback stays
   * filtered to `produces` (friction #16: without this, a drafting station
   * never saw the researching station's `research/` output and drafted
   * blind). Kept separate from `produces` precisely because `produces`
   * also grants copyback rights.
   */
  seeds: Schema.optionalKey(Schema.Array(Schema.String)),
  review: Schema.Boolean,
}) {}

export class StationsFile extends Schema.Class<StationsFile>("StationsFile")({
  schemaVersion: Schema.Literal(1),
  /** Provenance of the copy, e.g. "default". */
  template: Schema.String,
  stations: Schema.Record(Schema.String, Station),
}) {}

/**
 * The built-in "default" stations template — copied verbatim into every new
 * bundle's `stations.json` (data-model.md §2.13 example).
 */
export const DEFAULT_STATIONS_TEMPLATE: typeof StationsFile.Type = {
  schemaVersion: 1,
  template: "default",
  stations: {
    researching: {
      doer: "agent",
      // Bundle slug, not "william/research-a-skill" -- same rule as
      // "drafting" below (station.skill resolves to another bundle in the
      // SAME workspace, and bundle slugs cannot contain "/"). Real,
      // working skill as of Phase 19: skills/william-research-a-skill/.
      skill: "william-research-a-skill",
      produces: ["research/"],
      review: true,
    },
    drafting: {
      doer: "agent",
      // Bundle slug, not "william/draft-skill-md" -- station.skill resolves
      // to another bundle in the SAME workspace (StationEngine.ts), and
      // bundle slugs cannot contain "/" (WorkspaceService.ts's SLUG_PATTERN).
      // Real, working skill as of Phase 10: skills/william-draft-skill-md/.
      skill: "william-draft-skill-md",
      produces: ["design.md", "output/SKILL.md"],
      // Friction #16: the researching station's output must reach the
      // drafting agent's sandbox, without granting copyback rights over it.
      seeds: ["research/"],
      review: true,
    },
    evaluating: {
      doer: "agent",
      produces: ["evals/", "runs/"],
      // Eval authoring needs to see what it is evaluating -- the research,
      // the design, and the drafted skill -- again read-only (friction #16).
      seeds: ["research/", "design.md", "output/"],
      review: true,
    },
  },
};
