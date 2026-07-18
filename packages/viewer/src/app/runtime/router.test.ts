import { describe, expect, test } from "bun:test";
import {
  bundleFileHref,
  bundleFixtureHref,
  bundleHref,
  bundleRunHref,
  labHref,
  parseRoute,
  shipBundleHref,
  trackHref,
} from "./router.tsx";

describe("parseRoute", () => {
  test("canonical Board · Lab · Ship · Receive · Track routes (#72, #109)", () => {
    expect(parseRoute("/", "")).toEqual({ name: "board" });
    expect(parseRoute("/lab", "")).toEqual({ name: "lab", view: "bench", bundle: undefined });
    expect(parseRoute("/track", "")).toEqual({ name: "track", view: "catalog", archive: false });
    expect(parseRoute("/ship", "")).toEqual({ name: "ship" });
    expect(parseRoute("/ship/my-skill", "")).toEqual({ name: "ship-bundle", slug: "my-skill" });
    expect(parseRoute("/receive", "")).toEqual({ name: "receive" });
  });

  test("Track's room is a URL query; the Archive drawer's open state round-trips too (#109)", () => {
    expect(parseRoute("/track", "?view=feed")).toEqual({ name: "track", view: "feed", archive: false });
    expect(parseRoute("/track", "?view=bogus")).toEqual({ name: "track", view: "catalog", archive: false });
    expect(parseRoute("/track", "?archive=1")).toEqual({ name: "track", view: "catalog", archive: true });
  });

  test("old /activity deep links alias into Track's Feed (#109: display-layer only, old routes keep working)", () => {
    expect(parseRoute("/activity", "")).toEqual({ name: "track", view: "feed", archive: false });
  });

  test("old bundle tab paths alias into their card-era homes (#109: evals -> models, versions -> lineage)", () => {
    expect(parseRoute("/bundles/my-skill/evals", "")).toEqual({
      name: "bundle",
      slug: "my-skill",
      tab: "models",
      runId: undefined,
      file: undefined,
    });
    expect(parseRoute("/bundles/my-skill/versions", "")).toEqual({
      name: "bundle",
      slug: "my-skill",
      tab: "lineage",
      runId: undefined,
      file: undefined,
    });
    expect(parseRoute("/bundles/my-skill/coverage", "")).toEqual({
      name: "bundle",
      slug: "my-skill",
      tab: "coverage",
      runId: undefined,
      file: undefined,
    });
    expect(parseRoute("/bundles/my-skill/bogus", "")).toEqual({ name: "not-found" });
  });

  test("the Instructions tab (card-fidelity round: the skill itself, first-class) parses at /bundles/:slug/instructions", () => {
    expect(parseRoute("/bundles/my-skill/instructions", "")).toEqual({
      name: "bundle",
      slug: "my-skill",
      tab: "instructions",
      runId: undefined,
      file: undefined,
      fixture: undefined,
      from: undefined,
    });
  });

  test("?from= carries the card's origin room (round 2); absent/invalid = undefined (= Make), exactly today's direct-URL behavior", () => {
    expect(parseRoute("/bundles/my-skill", "?from=improve")).toEqual({
      name: "bundle",
      slug: "my-skill",
      tab: "overview",
      runId: undefined,
      file: undefined,
      fixture: undefined,
      from: "improve",
    });
    for (const origin of ["track", "ship", "receive"] as const) {
      const route = parseRoute("/bundles/my-skill", `?from=${origin}`);
      expect(route.name === "bundle" && route.from).toBe(origin);
    }
    expect(parseRoute("/bundles/my-skill", "?from=bogus")).toEqual(parseRoute("/bundles/my-skill", ""));
    const bare = parseRoute("/bundles/my-skill", "");
    expect(bare.name === "bundle" && bare.from).toBeUndefined();
  });

  test("bundleHref threads ?from= and drops it entirely when absent (old URLs stay byte-identical)", () => {
    expect(bundleHref("my-skill")).toBe("/bundles/my-skill");
    expect(bundleHref("my-skill", "overview", "improve")).toBe("/bundles/my-skill?from=improve");
    // Preservation across tab switches: the same `from` rides every tab href.
    expect(bundleHref("my-skill", "models", "improve")).toBe("/bundles/my-skill/models?from=improve");
    const [pathname, search] = bundleHref("my-skill", "models", "improve").split("?");
    const route = parseRoute(pathname ?? "", `?${search}`);
    expect(route.name === "bundle" && route.tab).toBe("models");
    expect(route.name === "bundle" && route.from).toBe("improve");
  });

  test("?fixture= (Coverage's cross-link into Models) parses and round-trips through bundleFixtureHref, with ?from= preserved", () => {
    expect(bundleFixtureHref("my-skill", "golden-basic")).toBe("/bundles/my-skill/models?fixture=golden-basic");
    const href = bundleFixtureHref("my-skill", "golden-basic", "track");
    expect(href).toBe("/bundles/my-skill/models?fixture=golden-basic&from=track");
    const [pathname, search] = href.split("?");
    expect(parseRoute(pathname ?? "", `?${search}`)).toEqual({
      name: "bundle",
      slug: "my-skill",
      tab: "models",
      runId: undefined,
      file: undefined,
      fixture: "golden-basic",
      from: "track",
    });
  });

  test("bundleRunHref / bundleFileHref preserve ?from= alongside their own params", () => {
    expect(bundleRunHref("my-skill", "run-1", "ship")).toBe("/bundles/my-skill/models?run=run-1&from=ship");
    expect(bundleFileHref("my-skill", "design.md", "receive")).toBe(
      "/bundles/my-skill/files?file=design.md&from=receive",
    );
  });

  test("old /catalog, /port(/:slug), and /skillbook(/:slug) paths still parse to the same routes (bookmarks/deep links survive)", () => {
    expect(parseRoute("/catalog", "")).toEqual({ name: "lab", view: "bench", bundle: undefined });
    expect(parseRoute("/port", "")).toEqual({ name: "ship" });
    expect(parseRoute("/port/my-skill", "")).toEqual({ name: "ship-bundle", slug: "my-skill" });
    expect(parseRoute("/skillbook", "")).toEqual({ name: "ship" });
    expect(parseRoute("/skillbook/my-skill", "")).toEqual({ name: "ship-bundle", slug: "my-skill" });
  });

  test("the Lab's mode is a URL query, not a path segment (#83)", () => {
    expect(parseRoute("/lab", "?view=queue")).toEqual({ name: "lab", view: "queue", bundle: undefined });
    expect(parseRoute("/lab", "?view=bogus")).toEqual({ name: "lab", view: "bench", bundle: undefined });
    expect(parseRoute("/lab", "?view=queue&bundle=my-skill")).toEqual({
      name: "lab",
      view: "queue",
      bundle: "my-skill",
    });
    // The alias path carries the same query mechanism.
    expect(parseRoute("/catalog", "?view=queue")).toEqual({ name: "lab", view: "queue", bundle: undefined });
  });

  test("slug segments are URI-decoded on both the canonical and alias paths", () => {
    expect(parseRoute("/ship/my%20skill", "")).toEqual({ name: "ship-bundle", slug: "my skill" });
    expect(parseRoute("/port/my%20skill", "")).toEqual({ name: "ship-bundle", slug: "my skill" });
    expect(parseRoute("/skillbook/my%20skill", "")).toEqual({ name: "ship-bundle", slug: "my skill" });
  });

  test("unrelated multi-segment paths under the alias prefixes still miss", () => {
    expect(parseRoute("/catalog/extra", "")).toEqual({ name: "not-found" });
    expect(parseRoute("/skillbook/a/b", "")).toEqual({ name: "not-found" });
    expect(parseRoute("/port/a/b", "")).toEqual({ name: "not-found" });
    expect(parseRoute("/receive/extra", "")).toEqual({ name: "not-found" });
  });
});

describe("shipBundleHref", () => {
  test("builds the canonical /ship/:slug URL, encoding the slug", () => {
    expect(shipBundleHref("my skill")).toBe("/ship/my%20skill");
  });
});

describe("labHref", () => {
  test("Bench has no query string at all -- it's the same bare /lab URL as always", () => {
    expect(labHref("bench")).toBe("/lab");
  });

  test("Queue adds ?view=queue", () => {
    expect(labHref("queue")).toBe("/lab?view=queue");
  });

  test("a bundle filter round-trips through parseRoute", () => {
    const href = labHref("queue", "my skill");
    expect(href).toBe("/lab?view=queue&bundle=my+skill");
    const [pathname, search] = href.split("?");
    expect(parseRoute(pathname, `?${search}`)).toEqual({ name: "lab", view: "queue", bundle: "my skill" });
  });

  test("Bench with a bundle filter still carries it, even though Bench itself ignores it", () => {
    expect(labHref("bench", "my-skill")).toBe("/lab?bundle=my-skill");
  });
});

describe("bundleHref (unaffected by #72)", () => {
  test("still builds /bundles/:slug", () => {
    expect(bundleHref("my-skill")).toBe("/bundles/my-skill");
  });
});

describe("trackHref (#109)", () => {
  test("Catalog is the bare /track URL; Feed and the drawer are queries", () => {
    expect(trackHref()).toBe("/track");
    expect(trackHref("catalog")).toBe("/track");
    expect(trackHref("feed")).toBe("/track?view=feed");
    expect(trackHref("catalog", { archive: true })).toBe("/track?archive=1");
  });

  test("the drawer flag round-trips through parseRoute", () => {
    const href = trackHref("catalog", { archive: true });
    const [pathname, search] = href.split("?");
    expect(parseRoute(pathname ?? "", `?${search}`)).toEqual({ name: "track", view: "catalog", archive: true });
  });
});

describe("bundleRunHref (#109: runs live under Models now)", () => {
  test("points at the models tab", () => {
    expect(bundleRunHref("my-skill", undefined)).toBe("/bundles/my-skill/models");
    expect(bundleRunHref("my-skill", "run-1")).toBe("/bundles/my-skill/models?run=run-1");
  });
});
