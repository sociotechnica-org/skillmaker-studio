import { describe, expect, test } from "bun:test";
import { activeEntries, orderCatalog, retiredEntries } from "./trackSort.ts";
import type { CatalogEntry } from "./schemas.ts";

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
  lastShipment: null,
  lastActivityAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

describe("orderCatalog", () => {
  const older = entry({ slug: "older", name: "Zeta", stage: "published", lastActivityAt: "2026-07-01T00:00:00.000Z" });
  const newer = entry({ slug: "newer", name: "Alpha", stage: "idea", lastActivityAt: "2026-07-15T00:00:00.000Z" });
  const middle = entry({ slug: "middle", name: "Mid", stage: "idea", lastActivityAt: "2026-07-10T00:00:00.000Z" });

  test("recent: newest activity first", () => {
    expect(orderCatalog([older, newer, middle], "recent").map((e) => e.slug)).toEqual([
      "newer",
      "middle",
      "older",
    ]);
  });

  test("name: alphabetical", () => {
    expect(orderCatalog([older, newer, middle], "name").map((e) => e.slug)).toEqual([
      "newer",
      "middle",
      "older",
    ]);
    expect(orderCatalog([older, middle], "name").map((e) => e.name)).toEqual(["Mid", "Zeta"]);
  });

  test("stage: ladder order with recency tiebreak; input never mutated", () => {
    const input = [older, newer, middle];
    const sorted = orderCatalog(input, "stage");
    expect(sorted.map((e) => e.slug)).toEqual(["newer", "middle", "older"]);
    expect(input.map((e) => e.slug)).toEqual(["older", "newer", "middle"]);
  });
});

describe("the Archive drawer fold", () => {
  test("retired/active partition the Catalog; nothing is dropped", () => {
    const kept = entry({ slug: "kept" });
    const retired = entry({ slug: "retired", archived: true });
    expect(retiredEntries([kept, retired]).map((e) => e.slug)).toEqual(["retired"]);
    expect(activeEntries([kept, retired]).map((e) => e.slug)).toEqual(["kept"]);
  });
});
