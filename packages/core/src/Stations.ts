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
  /** The skill the station-agent runs with, e.g. "william/research-a-skill". */
  skill: Schema.optionalKey(Schema.String),
  /** Paths (relative to the bundle) this station's work produces. */
  produces: Schema.Array(Schema.String),
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
      skill: "william/research-a-skill",
      produces: ["research/"],
      review: true,
    },
    drafting: {
      doer: "agent",
      skill: "william/draft-skill-md",
      produces: ["design.md", "output/SKILL.md"],
      review: true,
    },
    evaluating: {
      doer: "agent",
      produces: ["evals/", "runs/"],
      review: true,
    },
  },
};
