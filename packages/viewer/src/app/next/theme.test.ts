import { describe, expect, test } from "bun:test";
import { effectiveTheme } from "./theme.ts";

describe("effectiveTheme", () => {
  test("explicit stored choice wins over the OS preference", () => {
    expect(effectiveTheme("dark", false)).toBe("dark");
    expect(effectiveTheme("light", true)).toBe("light");
  });

  test("stored choice agreeing with the OS still returns it", () => {
    expect(effectiveTheme("dark", true)).toBe("dark");
    expect(effectiveTheme("light", false)).toBe("light");
  });

  test("first visit (nothing stored) follows prefers-color-scheme", () => {
    expect(effectiveTheme(null, true)).toBe("dark");
    expect(effectiveTheme(null, false)).toBe("light");
  });

  test("garbage in storage falls back to the OS preference", () => {
    expect(effectiveTheme("solarized", true)).toBe("dark");
    expect(effectiveTheme("", false)).toBe("light");
  });
});
