import { describe, expect, test } from "bun:test";
import { DOORWAY_WINDOW_DAYS, isWithinDoorway, partitionDoorway } from "./boardDoorway.ts";
import type { BundleRecord } from "./schemas.ts";

const NOW = new Date("2026-07-15T00:00:00.000Z");

const bundle = (overrides: Partial<BundleRecord> & { slug: string }): BundleRecord => ({
  name: overrides.slug,
  oneLiner: "",
  tags: [],
  created: "2026-01-01",
  stage: "published",
  substate: "working",
  archived: false,
  designHash: "sha256:aaa",
  outputHash: "sha256:bbb",
  drift: "in-sync",
  ...overrides,
});

const daysAgoIso = (days: number): string =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe("isWithinDoorway", () => {
  test("inside the window: just published, well within DOORWAY_WINDOW_DAYS", () => {
    const b = bundle({ slug: "fresh", stageChangedAt: daysAgoIso(1) });
    expect(isWithinDoorway(b, NOW)).toBe(true);
  });

  test("outside the window: published well over DOORWAY_WINDOW_DAYS ago", () => {
    const b = bundle({ slug: "stale", stageChangedAt: daysAgoIso(30) });
    expect(isWithinDoorway(b, NOW)).toBe(false);
  });

  test("exactly at the boundary (age === DOORWAY_WINDOW_DAYS): outside the window", () => {
    const b = bundle({ slug: "boundary", stageChangedAt: daysAgoIso(DOORWAY_WINDOW_DAYS) });
    expect(isWithinDoorway(b, NOW)).toBe(false);
  });

  test("just inside the boundary (age fractionally less than DOORWAY_WINDOW_DAYS): within the window", () => {
    const b = bundle({
      slug: "just-inside",
      stageChangedAt: new Date(NOW.getTime() - (DOORWAY_WINDOW_DAYS * 24 * 60 * 60 * 1000 - 1)).toISOString(),
    });
    expect(isWithinDoorway(b, NOW)).toBe(true);
  });

  test("no stageChangedAt at all (old journal / tolerant-fold edge case): elided, not assumed fresh", () => {
    const b = bundle({ slug: "no-timestamp" });
    expect(isWithinDoorway(b, NOW)).toBe(false);
  });
});

describe("partitionDoorway", () => {
  test("footer count: bundles within the window are visible, the rest are counted, never dropped silently", () => {
    const fresh1 = bundle({ slug: "fresh-1", stageChangedAt: daysAgoIso(0) });
    const fresh2 = bundle({ slug: "fresh-2", stageChangedAt: daysAgoIso(6) });
    const stale1 = bundle({ slug: "stale-1", stageChangedAt: daysAgoIso(7) });
    const stale2 = bundle({ slug: "stale-2", stageChangedAt: daysAgoIso(90) });

    const result = partitionDoorway([fresh1, stale1, fresh2, stale2], NOW);

    expect(result.visible.map((b) => b.slug)).toEqual(["fresh-1", "fresh-2"]);
    expect(result.elidedCount).toBe(2);
  });

  test("no elided bundles: footer count is zero, nothing to elide", () => {
    const fresh = bundle({ slug: "fresh", stageChangedAt: daysAgoIso(1) });
    const result = partitionDoorway([fresh], NOW);
    expect(result.visible.map((b) => b.slug)).toEqual(["fresh"]);
    expect(result.elidedCount).toBe(0);
  });

  test("empty input: no cards, no elided count", () => {
    const result = partitionDoorway([], NOW);
    expect(result.visible).toEqual([]);
    expect(result.elidedCount).toBe(0);
  });

  test("does not mutate the input array", () => {
    const a = bundle({ slug: "a", stageChangedAt: daysAgoIso(1) });
    const b = bundle({ slug: "b", stageChangedAt: daysAgoIso(90) });
    const input = [a, b];

    partitionDoorway(input, NOW);

    expect(input.map((entry) => entry.slug)).toEqual(["a", "b"]);
  });
});
