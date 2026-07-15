import { describe, expect, test } from "bun:test";
import { bundleHref, labHref, parseRoute, shipBundleHref } from "./router.tsx";

describe("parseRoute", () => {
  test("canonical Board · Lab · Ship · Receive · Activity routes (#72)", () => {
    expect(parseRoute("/", "")).toEqual({ name: "board" });
    expect(parseRoute("/lab", "")).toEqual({ name: "lab", view: "bench", bundle: undefined });
    expect(parseRoute("/activity", "")).toEqual({ name: "activity" });
    expect(parseRoute("/ship", "")).toEqual({ name: "ship" });
    expect(parseRoute("/ship/my-skill", "")).toEqual({ name: "ship-bundle", slug: "my-skill" });
    expect(parseRoute("/receive", "")).toEqual({ name: "receive" });
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
