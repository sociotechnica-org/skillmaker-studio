import { describe, expect, test } from "bun:test";
import { coverageState, driftNeedsAttention, orderForAttention } from "./labOrder.ts";
import type { CatalogEntry, Drift } from "./schemas.ts";

const entry = (overrides: Partial<CatalogEntry> & { slug: string }): CatalogEntry => ({
  name: overrides.slug,
  oneLiner: "",
  tags: [],
  stage: "idea",
  archived: false,
  drift: "in-sync",
  latestVersion: null,
  fixtureCount: 0,
  measuredFixtureCount: 0,
  openTodoCount: 0,
  unverified: false,
  ...overrides,
});

describe("driftNeedsAttention", () => {
  test("only the three changed states earn a pill", () => {
    const cases: ReadonlyArray<[Drift, boolean]> = [
      ["no-version", false],
      ["in-sync", false],
      ["design-changed", true],
      ["output-hand-edited", true],
      ["both", true],
    ];
    for (const [drift, expected] of cases) {
      expect(driftNeedsAttention(drift)).toBe(expected);
    }
  });
});

describe("coverageState", () => {
  test("no fixtures yet", () => {
    expect(coverageState({ fixtureCount: 0, measuredFixtureCount: 0 })).toBe("no-fixtures");
  });

  test("fixtures exist but under-measured", () => {
    expect(coverageState({ fixtureCount: 3, measuredFixtureCount: 1 })).toBe("under-measured");
  });

  test("all fixtures measured", () => {
    expect(coverageState({ fixtureCount: 3, measuredFixtureCount: 3 })).toBe("fully-measured");
  });
});

describe("orderForAttention", () => {
  test("drifted, then open todos, then measurement gaps, then clean, then archived -- stable within groups", () => {
    const clean1 = entry({ slug: "clean-1", drift: "in-sync", fixtureCount: 2, measuredFixtureCount: 2 });
    const gapNoFixtures = entry({ slug: "gap-no-fixtures", drift: "in-sync", fixtureCount: 0, measuredFixtureCount: 0 });
    const gapUnderMeasured = entry({
      slug: "gap-under-measured",
      drift: "no-version",
      fixtureCount: 4,
      measuredFixtureCount: 1,
    });
    const drifted1 = entry({ slug: "drifted-1", drift: "design-changed", fixtureCount: 2, measuredFixtureCount: 2 });
    const drifted2 = entry({ slug: "drifted-2", drift: "both", fixtureCount: 0, measuredFixtureCount: 0 });
    const openTodos1 = entry({
      slug: "open-todos-1",
      drift: "in-sync",
      fixtureCount: 2,
      measuredFixtureCount: 2,
      openTodoCount: 3,
    });
    const openTodos2 = entry({
      slug: "open-todos-2",
      drift: "no-version",
      fixtureCount: 0,
      measuredFixtureCount: 0,
      openTodoCount: 1,
    });
    const archived = entry({
      slug: "archived-drifted",
      drift: "both",
      archived: true,
      fixtureCount: 0,
      measuredFixtureCount: 0,
    });

    const input = [clean1, gapNoFixtures, drifted1, archived, openTodos1, gapUnderMeasured, drifted2, openTodos2];
    const ordered = orderForAttention(input);

    expect(ordered.map((e) => e.slug)).toEqual([
      "drifted-1",
      "drifted-2",
      "open-todos-1",
      "open-todos-2",
      "gap-no-fixtures",
      "gap-under-measured",
      "clean-1",
      "archived-drifted",
    ]);
  });

  test("open todos outrank a measurement gap but not drift", () => {
    const gap = entry({ slug: "gap", fixtureCount: 3, measuredFixtureCount: 0 });
    const openTodos = entry({ slug: "open-todos", fixtureCount: 3, measuredFixtureCount: 3, openTodoCount: 1 });
    const drifted = entry({ slug: "drifted", drift: "both", fixtureCount: 3, measuredFixtureCount: 3, openTodoCount: 5 });

    expect(orderForAttention([gap, openTodos, drifted]).map((e) => e.slug)).toEqual([
      "drifted",
      "open-todos",
      "gap",
    ]);
  });

  test("archived sinks below everything, even a drifted archived bundle vs. a clean active one", () => {
    const activeClean = entry({ slug: "active-clean", fixtureCount: 1, measuredFixtureCount: 1 });
    const archivedDrifted = entry({ slug: "archived-drifted", drift: "both", archived: true });

    expect(orderForAttention([archivedDrifted, activeClean]).map((e) => e.slug)).toEqual([
      "active-clean",
      "archived-drifted",
    ]);
  });

  test("archived sinks below everything even with open todos", () => {
    const activeClean = entry({ slug: "active-clean", fixtureCount: 1, measuredFixtureCount: 1 });
    const archivedWithTodos = entry({ slug: "archived-with-todos", archived: true, openTodoCount: 4 });

    expect(orderForAttention([archivedWithTodos, activeClean]).map((e) => e.slug)).toEqual([
      "active-clean",
      "archived-with-todos",
    ]);
  });

  test("preserves incoming order for entries in the same group", () => {
    const a = entry({ slug: "a", drift: "design-changed" });
    const b = entry({ slug: "b", drift: "output-hand-edited" });
    const c = entry({ slug: "c", drift: "both" });

    expect(orderForAttention([c, a, b]).map((e) => e.slug)).toEqual(["c", "a", "b"]);
  });

  test("does not mutate the input array", () => {
    const a = entry({ slug: "a", drift: "both" });
    const b = entry({ slug: "b", drift: "in-sync", fixtureCount: 1, measuredFixtureCount: 1 });
    const input = [b, a];

    orderForAttention(input);

    expect(input.map((e) => e.slug)).toEqual(["b", "a"]);
  });

  // Issue #93, "the Unverified badge needs no special case": an unverified
  // entry (received + zero measurements ever) always carries
  // `measuredFixtureCount: 0` (a strict subset of "ever" can't be positive
  // when "ever" is zero) -- so it composes into the existing measurement-gap
  // tier automatically, ranked below drift/open-todos and above clean, with
  // no dedicated `unverified` branch in `orderForAttention` at all.
  test("an Unverified entry composes into the existing measurement-gap tier -- no special case needed", () => {
    const clean = entry({ slug: "clean", fixtureCount: 2, measuredFixtureCount: 2 });
    const unverifiedNoFixtures = entry({ slug: "unverified-no-fixtures", unverified: true, fixtureCount: 0, measuredFixtureCount: 0 });
    const unverifiedWithFixtures = entry({
      slug: "unverified-with-fixtures",
      unverified: true,
      fixtureCount: 3,
      measuredFixtureCount: 0,
    });
    const openTodos = entry({
      slug: "open-todos",
      fixtureCount: 2,
      measuredFixtureCount: 2,
      openTodoCount: 1,
    });
    const drifted = entry({ slug: "drifted", drift: "both", fixtureCount: 2, measuredFixtureCount: 2 });

    const ordered = orderForAttention([clean, unverifiedNoFixtures, openTodos, drifted, unverifiedWithFixtures]);

    // Drift and open todos still outrank an unverified/measurement-gap
    // entry; both unverified entries land in the gap tier, ahead of clean.
    expect(ordered.map((e) => e.slug)).toEqual([
      "drifted",
      "open-todos",
      "unverified-no-fixtures",
      "unverified-with-fixtures",
      "clean",
    ]);
  });
});
