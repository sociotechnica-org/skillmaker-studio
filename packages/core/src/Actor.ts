/**
 * Provenance for every mutating record: who did it.
 * Inherited law: provenance (Actor) on every mutating record.
 */
import { Schema } from "effect";

export class Actor extends Schema.Class<Actor>("Actor")({
  kind: Schema.Literals(["user", "agent", "process"]),
  name: Schema.String,
  /** ACP provider id; present when `kind` is `"agent"`. */
  provider: Schema.optionalKey(Schema.String),
}) {}

export type ActorEncoded = typeof Actor.Encoded;
