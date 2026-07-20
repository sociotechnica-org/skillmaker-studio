/**
 * Unit tests for `main.ts`'s central error boundary (F5 verifier fix):
 * known, human-readable tagged errors (`JournalReadError`, `WorkspaceIOError`)
 * render as one honest line + suggestion instead of a full Effect stack
 * trace, unless `--debug`/`SKILLMAKER_DEBUG` is set -- everything else
 * (unknown tags, defects, multi-failure causes) keeps the existing
 * full-stack-trace rendering unchanged.
 */
import { describe, expect, test } from "bun:test";
import { Cause } from "effect";
import { formatKnownFailure, isDebugRequested, renderFailure } from "../src/ErrorBoundary.ts";

const journalReadError = { _tag: "JournalReadError", message: "corrupt journal at .skillmaker/events.jsonl" };
const workspaceIOError = { _tag: "WorkspaceIOError", message: "permission denied writing to workspace" };
const unknownTaggedError = { _tag: "SomeOtherError", message: "not one we recognize" };

describe("isDebugRequested", () => {
  test("true when --debug is anywhere in argv", () => {
    expect(isDebugRequested(["init", "--debug"], {})).toBe(true);
    expect(isDebugRequested(["--debug", "init"], {})).toBe(true);
  });

  test("true when SKILLMAKER_DEBUG is set to a non-empty value", () => {
    expect(isDebugRequested(["init"], { SKILLMAKER_DEBUG: "1" })).toBe(true);
  });

  test("false when neither is present", () => {
    expect(isDebugRequested(["init"], {})).toBe(false);
    expect(isDebugRequested(["init"], { SKILLMAKER_DEBUG: "" })).toBe(false);
  });
});

describe("formatKnownFailure", () => {
  test("renders a one-line message + suggestion for JournalReadError", () => {
    const cause = Cause.fail(journalReadError);
    const rendered = formatKnownFailure(cause);
    expect(rendered).toBeDefined();
    expect(rendered).toContain("skillmaker: corrupt journal at .skillmaker/events.jsonl");
    expect(rendered).toContain("re-run with --debug for the full stack trace");
    expect(rendered).not.toContain("skillmaker: unexpected error");
  });

  test("renders a one-line message + suggestion for WorkspaceIOError", () => {
    const cause = Cause.fail(workspaceIOError);
    const rendered = formatKnownFailure(cause);
    expect(rendered).toBeDefined();
    expect(rendered).toContain("skillmaker: permission denied writing to workspace");
    expect(rendered).toContain("check file permissions");
  });

  test("undefined for an unrecognized tagged error", () => {
    const cause = Cause.fail(unknownTaggedError);
    expect(formatKnownFailure(cause)).toBeUndefined();
  });

  test("undefined for a defect (not a tagged failure)", () => {
    const cause = Cause.die(new Error("boom"));
    expect(formatKnownFailure(cause)).toBeUndefined();
  });

  test("undefined for a multi-failure cause", () => {
    const cause = Cause.combine(Cause.fail(journalReadError), Cause.fail(workspaceIOError));
    expect(formatKnownFailure(cause)).toBeUndefined();
  });
});

describe("renderFailure", () => {
  test("known error, debug off -> the short one-liner", () => {
    const cause = Cause.fail(journalReadError);
    const rendered = renderFailure(cause, false);
    expect(rendered).toContain("skillmaker: corrupt journal");
    expect(rendered).not.toContain("skillmaker: unexpected error");
  });

  test("known error, debug on -> falls back to the full stack trace", () => {
    const cause = Cause.fail(journalReadError);
    const rendered = renderFailure(cause, true);
    expect(rendered).toContain("skillmaker: unexpected error");
  });

  test("unknown error, debug off -> still falls back to the full stack trace", () => {
    const cause = Cause.fail(unknownTaggedError);
    const rendered = renderFailure(cause, false);
    expect(rendered).toContain("skillmaker: unexpected error");
  });

  test("defect, debug off -> falls back to the full stack trace", () => {
    const cause = Cause.die(new Error("boom"));
    const rendered = renderFailure(cause, false);
    expect(rendered).toContain("skillmaker: unexpected error");
  });
});
