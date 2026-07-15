import { describe, expect, test } from "bun:test";
import { bundleHref, parseRoute, portBundleHref } from "./router.tsx";

describe("parseRoute", () => {
  test("canonical Board · Lab · Port routes (#64)", () => {
    expect(parseRoute("/", "")).toEqual({ name: "board" });
    expect(parseRoute("/lab", "")).toEqual({ name: "lab" });
    expect(parseRoute("/activity", "")).toEqual({ name: "activity" });
    expect(parseRoute("/port", "")).toEqual({ name: "port" });
    expect(parseRoute("/port/my-skill", "")).toEqual({ name: "port-bundle", slug: "my-skill" });
  });

  test("old /catalog and /skillbook(/:slug) paths still parse to the same routes (bookmarks/deep links survive)", () => {
    expect(parseRoute("/catalog", "")).toEqual({ name: "lab" });
    expect(parseRoute("/skillbook", "")).toEqual({ name: "port" });
    expect(parseRoute("/skillbook/my-skill", "")).toEqual({ name: "port-bundle", slug: "my-skill" });
  });

  test("slug segments are URI-decoded on both the canonical and alias path", () => {
    expect(parseRoute("/port/my%20skill", "")).toEqual({ name: "port-bundle", slug: "my skill" });
    expect(parseRoute("/skillbook/my%20skill", "")).toEqual({ name: "port-bundle", slug: "my skill" });
  });

  test("unrelated multi-segment paths under the alias prefixes still miss", () => {
    expect(parseRoute("/catalog/extra", "")).toEqual({ name: "not-found" });
    expect(parseRoute("/skillbook/a/b", "")).toEqual({ name: "not-found" });
  });
});

describe("portBundleHref", () => {
  test("builds the canonical /port/:slug URL, encoding the slug", () => {
    expect(portBundleHref("my skill")).toBe("/port/my%20skill");
  });
});

describe("bundleHref (unaffected by #64)", () => {
  test("still builds /bundles/:slug", () => {
    expect(bundleHref("my-skill")).toBe("/bundles/my-skill");
  });
});
