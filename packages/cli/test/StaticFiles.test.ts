/**
 * Unit tests for the static-file path-traversal guard used by
 * `skillmaker start`'s server (packages/cli/src/server/StaticFiles.ts).
 *
 * Note on why these are pure unit tests rather than HTTP round-trips: a
 * spec-compliant HTTP client (browser `fetch`, curl, Node's `fetch`) already
 * collapses literal `..` segments -- and their percent-encoded `%2e%2e`
 * equivalents -- before the request line is ever sent, per the WHATWG URL
 * spec's dot-segment normalization. So `GET /../etc/passwd` never reaches
 * the server as a traversal attempt at all; testing the guard meaningfully
 * requires calling it directly with a decoded path that contains `..`, or
 * exercising the encoded-slash bypass (`/..%2f..%2fetc%2fpasswd`) that HTTP
 * clients do NOT collapse client-side (see the e2e test for that case).
 */
import { describe, expect, test } from "bun:test";
import { join, sep } from "node:path";
import { contentTypeFor, resolveStaticPath } from "../src/server/StaticFiles.ts";

describe("resolveStaticPath", () => {
  const root = join(sep, "srv", "viewer", "dist");

  test("resolves a plain path under root", () => {
    expect(resolveStaticPath(root, "/index.html")).toBe(join(root, "index.html"));
  });

  test("resolves a nested asset path under root", () => {
    expect(resolveStaticPath(root, "/_astro/app.js")).toBe(join(root, "_astro", "app.js"));
  });

  test("resolves the root itself for /", () => {
    expect(resolveStaticPath(root, "/")).toBe(root);
  });

  test("rejects a literal .. escape", () => {
    expect(resolveStaticPath(root, "/../secret.txt")).toBeUndefined();
  });

  test("rejects a deep .. escape reaching outside root", () => {
    expect(resolveStaticPath(root, "/../../../etc/passwd")).toBeUndefined();
  });

  test("rejects an encoded .. escape (the request-time decode step)", () => {
    expect(resolveStaticPath(root, "/%2e%2e/%2e%2e/etc/passwd")).toBeUndefined();
  });

  test("rejects the encoded-slash bypass (..%2f..%2fetc%2fpasswd)", () => {
    expect(resolveStaticPath(root, "/..%2f..%2fetc%2fpasswd")).toBeUndefined();
  });

  test("rejects a null-byte injection", () => {
    expect(resolveStaticPath(root, "/index.html%00.png")).toBeUndefined();
  });

  test("rejects malformed percent-encoding rather than throwing", () => {
    expect(resolveStaticPath(root, "/%E0%A4%A")).toBeUndefined();
  });

  test("a path that merely starts with the root's name but escapes is rejected", () => {
    // e.g. root "/srv/viewer/dist" vs a sibling "/srv/viewer/dist-evil" --
    // string-prefix checks without a separator boundary would wrongly allow
    // this; resolveStaticPath must not.
    const evilSibling = `${root}-evil`;
    expect(resolveStaticPath(root, `/../dist-evil/x`)).not.toBe(join(evilSibling, "x"));
  });
});

describe("contentTypeFor", () => {
  test("maps known extensions", () => {
    expect(contentTypeFor("index.html")).toContain("text/html");
    expect(contentTypeFor("app.js")).toContain("text/javascript");
    expect(contentTypeFor("styles.css")).toContain("text/css");
    expect(contentTypeFor("data.json")).toContain("application/json");
  });

  test("falls back to octet-stream for unknown extensions", () => {
    expect(contentTypeFor("file.unknownext")).toBe("application/octet-stream");
  });
});
