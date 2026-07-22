import { describe, expect, test } from "bun:test";
import { modelDisplayName } from "../src/ModelDisplay.ts";

describe("modelDisplayName (#141: display-layer blurb strip)", () => {
  test("everything from the first '·' separator is dropped, trimmed", () => {
    expect(modelDisplayName("Opus 4.6 · Most capable for complex work")).toBe("Opus 4.6");
    expect(modelDisplayName("Opus 4.6·blurb")).toBe("Opus 4.6");
    expect(modelDisplayName("A · b · c")).toBe("A");
  });

  test("a model string without a separator renders unchanged", () => {
    expect(modelDisplayName("gpt-5.6-sol[xhigh]")).toBe("gpt-5.6-sol[xhigh]");
    expect(modelDisplayName("claude-opus-4-6")).toBe("claude-opus-4-6");
    expect(modelDisplayName("")).toBe("");
  });
});
