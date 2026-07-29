import { describe, expect, test } from "bun:test";
import { normalizeAbsolutePath } from "../src/server/FsBrowse.ts";

describe("normalizeAbsolutePath", () => {
  test("accepts and normalizes Windows drive-letter paths with backslashes", () => {
    expect(normalizeAbsolutePath("C:\\Developer\\making-skills\\..\\skills")).toBe(
      "C:\\Developer\\skills",
    );
  });

  test("accepts Windows drive-letter paths with forward slashes", () => {
    expect(normalizeAbsolutePath("D:/work/skills")).toBe("D:\\work\\skills");
  });

  test("accepts UNC paths", () => {
    expect(normalizeAbsolutePath("\\\\server\\share\\skills")).toBe(
      "\\\\server\\share\\skills",
    );
  });

  test("accepts POSIX absolute paths", () => {
    expect(normalizeAbsolutePath("/home/me/skills/../project")).toBe("/home/me/project");
  });

  test("refuses relative paths in either separator style", () => {
    expect(normalizeAbsolutePath("projects/skills")).toBeUndefined();
    expect(normalizeAbsolutePath("projects\\skills")).toBeUndefined();
  });
});
