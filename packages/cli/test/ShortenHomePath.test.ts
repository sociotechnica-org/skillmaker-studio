/**
 * `GET /api/projects`'s display path: the workspace root shortened with `~`
 * when it sits under the user's home directory -- and left alone when it
 * doesn't (system temp dirs, other users' trees, prefix look-alikes).
 */
import { describe, expect, test } from "bun:test";
import { shortenHomePath } from "../src/server/Server.ts";

describe("shortenHomePath", () => {
  test("shortens a path under home", () => {
    expect(shortenHomePath("/Users/jess/Documents/code/skills", "/Users/jess")).toBe(
      "~/Documents/code/skills",
    );
  });

  test("home itself becomes ~", () => {
    expect(shortenHomePath("/Users/jess", "/Users/jess")).toBe("~");
  });

  test("a path outside home is untouched", () => {
    expect(shortenHomePath("/srv/workspaces/skills", "/Users/jess")).toBe("/srv/workspaces/skills");
  });

  test("a sibling whose name merely starts with home is NOT shortened", () => {
    expect(shortenHomePath("/Users/jessica/skills", "/Users/jess")).toBe("/Users/jessica/skills");
  });

  test("an empty home leaves the path untouched", () => {
    expect(shortenHomePath("/anything/at/all", "")).toBe("/anything/at/all");
  });
});
