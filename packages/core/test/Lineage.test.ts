/**
 * Lineage (issue #109): the chain of custody is a pure journal filter --
 * custody event types only, attributed via `bundleForEvent`, chronological
 * (journal) order preserved.
 */
import { describe, expect, test } from "bun:test";
import { Actor } from "../src/Actor.ts";
import type { JournalEvent } from "../src/Journal.ts";
import { CUSTODY_EVENT_TYPES, custodyEventsFor } from "../src/Lineage.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

let counter = 0;
const envelope = <T extends string>(type: T) => {
  counter += 1;
  return {
    schemaVersion: 1 as const,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    at: new Date(2026, 6, 10, 0, 0, counter).toISOString(),
    actor,
    type,
  };
};

describe("custodyEventsFor", () => {
  test("keeps custody events for the slug, in journal order", () => {
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } } as JournalEvent;
    const version = {
      ...envelope("skill.version_recorded"),
      payload: { bundle: "demo", hash: "sha256:aa", designHash: "sha256:bb" },
    } as JournalEvent;
    const shipped = {
      ...envelope("skill.shipped"),
      payload: { bundle: "demo", versionHash: "sha256:aa", destination: "acme", purpose: "x", receipts: [] },
    } as JournalEvent;
    const custody = custodyEventsFor([created, version, shipped], "demo");
    expect(custody.map((event) => event.type)).toEqual([
      "bundle.created",
      "skill.version_recorded",
      "skill.shipped",
    ]);
    // Chronological -- the chain reads forward.
    expect(custody[0]?.at.localeCompare(custody[2]?.at ?? "")).toBeLessThan(0);
  });

  test("drops working-life events (runs, reviews, stage moves) and other bundles' custody", () => {
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } } as JournalEvent;
    const moved = {
      ...envelope("bundle.stage_changed"),
      payload: { bundle: "demo", from: "idea", to: "researching" },
    } as JournalEvent;
    const review = {
      ...envelope("review.requested"),
      payload: { bundle: "demo", state: "researching" },
    } as JournalEvent;
    const otherCreated = { ...envelope("bundle.created"), payload: { bundle: "other" } } as JournalEvent;
    const custody = custodyEventsFor([created, moved, review, otherCreated], "demo");
    expect(custody.map((event) => event.type)).toEqual(["bundle.created"]);
  });

  test("skill.routed with an identity-granting target attributes; a target-less salvage attributes to nobody", () => {
    const routedNew = {
      ...envelope("skill.routed"),
      payload: { intake: "in-1", disposition: "new", bundle: "demo", reason: "adopted" },
    } as JournalEvent;
    const salvaged = {
      ...envelope("skill.routed"),
      payload: { intake: "in-2", disposition: "salvage", reason: "broken" },
    } as JournalEvent;
    expect(custodyEventsFor([routedNew, salvaged], "demo").map((event) => event.type)).toEqual([
      "skill.routed",
    ]);
  });

  test("retire/restore are custody facts", () => {
    const archived = { ...envelope("bundle.archived"), payload: { bundle: "demo" } } as JournalEvent;
    const restored = { ...envelope("bundle.restored"), payload: { bundle: "demo" } } as JournalEvent;
    expect(custodyEventsFor([archived, restored], "demo").map((event) => event.type)).toEqual([
      "bundle.archived",
      "bundle.restored",
    ]);
  });

  test("CUSTODY_EVENT_TYPES stays a custody list, not the whole catalog", () => {
    expect(CUSTODY_EVENT_TYPES).not.toContain("run.started");
    expect(CUSTODY_EVENT_TYPES).not.toContain("todo.opened");
    expect(CUSTODY_EVENT_TYPES).not.toContain("bundle.stage_changed");
  });
});
