import { describe, expect, test } from "bun:test";
import { isRunning } from "./presence.ts";

describe("isRunning", () => {
  test("an active dispatched run means running", () => {
    expect(isRunning({ active: [{ runId: "r1" }] }, null)).toBe(true);
  });

  test("an empty active list alone is not running", () => {
    expect(isRunning({ active: [] }, null)).toBe(false);
  });

  test("a chat session in running means running", () => {
    expect(isRunning(null, { active: { status: "running" } })).toBe(true);
  });

  test("a ready or starting chat session is not running", () => {
    expect(isRunning(null, { active: { status: "ready" } })).toBe(false);
    expect(isRunning(null, { active: { status: "starting" } })).toBe(false);
  });

  test("no session and no runs is not running", () => {
    expect(isRunning({ active: [] }, { active: null })).toBe(false);
  });

  test("missing signals (endpoint absent) contribute silence, never a spinner", () => {
    expect(isRunning(null, null)).toBe(false);
    expect(isRunning({}, {})).toBe(false);
  });

  test("either signal alone suffices", () => {
    expect(isRunning({ active: [{}] }, { active: { status: "ready" } })).toBe(true);
    expect(isRunning({ active: [] }, { active: { status: "running" } })).toBe(true);
  });
});
