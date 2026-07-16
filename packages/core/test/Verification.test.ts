/**
 * The Unverified badge's pure derivation (issue #93, `Mechanism - Receiving
 * Dock.md` §HOW, "The Unverified badge"). `Verification.test.ts` covers the
 * truth table in isolation, no I/O; `IndexService.test.ts` covers
 * `everReceived` surviving a real `rebuild()`/reindex round-trip, and the
 * E2E suite covers the full receive -> route -> catalog/bench payload
 * circuit.
 */
import { describe, expect, test } from "bun:test";
import { Actor } from "../src/Actor.ts";
import { BundleCreatedEvent, SkillRoutedEvent } from "../src/Journal.ts";
import type { JournalEvent, RouteDisposition } from "../src/Journal.ts";
import {
  foldEverReceivedBundles,
  IDENTITY_GRANTING_DISPOSITIONS,
  isIdentityGrantingDisposition,
  isUnverified,
} from "../src/Verification.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

/** A minimal `skill.routed` event -- only the fields `foldEverReceivedBundles` reads. */
const routed = (
  disposition: RouteDisposition,
  bundle: string | undefined,
  intake = "in-1",
): JournalEvent =>
  SkillRoutedEvent.make({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: "2026-07-16T00:00:00.000Z",
    actor,
    type: "skill.routed",
    payload: { intake, disposition, ...(bundle !== undefined ? { bundle } : {}), reason: "test" },
  });

describe("isIdentityGrantingDisposition / IDENTITY_GRANTING_DISPOSITIONS", () => {
  test("return/new/upgrade/fork grant identity; salvage does not", () => {
    expect(IDENTITY_GRANTING_DISPOSITIONS).toEqual(["return", "new", "upgrade", "fork"]);
    expect(isIdentityGrantingDisposition("return")).toBe(true);
    expect(isIdentityGrantingDisposition("new")).toBe(true);
    expect(isIdentityGrantingDisposition("upgrade")).toBe(true);
    expect(isIdentityGrantingDisposition("fork")).toBe(true);
    expect(isIdentityGrantingDisposition("salvage")).toBe(false);
  });
});

describe("foldEverReceivedBundles", () => {
  test("collects bundles named by an identity-granting skill.routed event", () => {
    const events = [routed("new", "alpha"), routed("return", "beta"), routed("upgrade", "gamma"), routed("fork", "delta")];
    const slugs = foldEverReceivedBundles(events);
    expect([...slugs].sort()).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  test("salvage grants no identity: a bundle it names (the one 'defended') never enters the set", () => {
    const events = [routed("salvage", "existing-bundle")];
    expect(foldEverReceivedBundles(events).has("existing-bundle")).toBe(false);
  });

  test("salvage with no bundle at all is a no-op", () => {
    const events = [routed("salvage", undefined)];
    expect(foldEverReceivedBundles(events).size).toBe(0);
  });

  test("a bundle never mentioned by any skill.routed event is absent from the set", () => {
    const events = [routed("new", "alpha")];
    expect(foldEverReceivedBundles(events).has("never-received")).toBe(false);
  });

  test("ignores non-skill.routed events", () => {
    const events: ReadonlyArray<JournalEvent> = [
      BundleCreatedEvent.make({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        at: "2026-07-16T00:00:00.000Z",
        actor,
        type: "bundle.created",
        payload: { bundle: "alpha" },
      }),
    ];
    expect(foldEverReceivedBundles(events).size).toBe(0);
  });

  test("arrival is a one-time fact: once received, always received, regardless of later events", () => {
    const events = [
      routed("new", "alpha"),
      // A later, unrelated routing for a different intake doesn't undo it.
      routed("salvage", "alpha", "in-2"),
    ];
    expect(foldEverReceivedBundles(events).has("alpha")).toBe(true);
  });
});

/**
 * The derivation truth table (issue #93's Testing section, all four rows):
 *   received + never-measured (any version)  -> badge
 *   received + measured-once (any version)   -> no badge
 *   never-received                            -> never badges, regardless of measurements
 *   traveled receipts (claims/ship snapshots) -> never count as measurements, so they
 *     never flip a received+unmeasured bundle to "measured" -- covered by
 *     `measurementCount` never including them at the `IndexService` layer
 *     (see `IndexService.test.ts`'s "traveled receipts" case); here we just
 *     confirm `isUnverified` treats `measurementCount` literally.
 */
describe("isUnverified: the four-row truth table", () => {
  test("received + zero measurements ever -> Unverified", () => {
    expect(isUnverified(true, 0)).toBe(true);
  });

  // Also covers "once cleared, a version bump never resurrects the badge":
  // a bundle received long ago and measured once at an old version has
  // `measurementCount` reflecting its FULL history (>0, never re-scoped to
  // "the latest version only" by any caller), so `isUnverified(true, 1)`
  // stays false even after the bundle moves to a new version with no
  // measurements of its own yet.
  test("received + at least one measurement ever -> not Unverified (first measurement EVER clears, for good)", () => {
    expect(isUnverified(true, 1)).toBe(false);
    expect(isUnverified(true, 42)).toBe(false);
  });

  test("never received -> never Unverified, regardless of measurement count", () => {
    expect(isUnverified(false, 0)).toBe(false);
    expect(isUnverified(false, 5)).toBe(false);
  });
});
