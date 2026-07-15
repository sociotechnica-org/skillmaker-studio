import { describe, expect, test } from "bun:test";
import { bundleHref, parseRoute, shipBundleHref } from "./router.tsx";

describe("parseRoute", () => {
  test("canonical Board · Lab · Ship · Receive · Activity routes (#72)", () => {
    expect(parseRoute("/", "")).toEqual({ name: "board" });
    expect(parseRoute("/lab", "")).toEqual({ name: "lab" });
    expect(parseRoute("/activity", "")).toEqual({ name: "activity" });
    expect(parseRoute("/ship", "")).toEqual({ name: "ship" });
    expect(parseRoute("/ship/my-skill", "")).toEqual({ name: "ship-bundle", slug: "my-skill" });
    expect(parseRoute("/receive", "")).toEqual({ name: "receive" });
  });

  test("old /catalog, /port(/:slug), and /skillbook(/:slug) paths still parse to the same routes (bookmarks/deep links survive)", () => {
    expect(parseRoute("/catalog", "")).toEqual({ name: "lab" });
    expect(parseRoute("/port", "")).toEqual({ name: "ship" });
    expect(parseRoute("/port/my-skill", "")).toEqual({ name: "ship-bundle", slug: "my-skill" });
    expect(parseRoute("/skillbook", "")).toEqual({ name: "ship" });
    expect(parseRoute("/skillbook/my-skill", "")).toEqual({ name: "ship-bundle", slug: "my-skill" });
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

describe("bundleHref (unaffected by #72)", () => {
  test("still builds /bundles/:slug", () => {
    expect(bundleHref("my-skill")).toBe("/bundles/my-skill");
  });
});
