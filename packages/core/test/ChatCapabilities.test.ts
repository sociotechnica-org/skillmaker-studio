/**
 * ChatCapabilities: the pure capability-mapping layer for the chat model
 * picker / effort selector / image uploads -- shaped by the 2026-07 spike
 * against the real shipped adapters, so the fixtures below mirror REAL
 * wire results:
 *
 * - claude-code (`@zed-industries/claude-code-acp@0.16.2`): plain model
 *   aliases in `models.availableModels`, no effort door of any kind.
 * - codex (`@agentclientprotocol/codex-acp@1.1.x`): every entry is a
 *   `model[effort]` variant with a `"Name (effort)"` display name.
 */
import { describe, expect, test } from "bun:test";
import {
  base64ByteSize,
  buildPromptBlocks,
  composeModelId,
  fallbackCatalogEntry,
  mapProviderCatalog,
  MAX_CHAT_IMAGE_BYTES,
  parseModelId,
  readImageCapability,
  validateChatImage,
} from "../src/ChatCapabilities.ts";

// ---------------------------------------------------------------------------
// Model id parse / compose
// ---------------------------------------------------------------------------

describe("parseModelId / composeModelId", () => {
  test("codex bracket form splits into base + effort", () => {
    expect(parseModelId("gpt-5.2-codex[medium]")).toEqual({ model: "gpt-5.2-codex", effort: "medium" });
  });

  test("plain claude aliases stay whole", () => {
    expect(parseModelId("default")).toEqual({ model: "default" });
    expect(parseModelId("claude-sonnet-4-5")).toEqual({ model: "claude-sonnet-4-5" });
  });

  test("compose round-trips: with effort -> bracketed; without -> verbatim", () => {
    expect(composeModelId("gpt-5.2-codex", "high")).toBe("gpt-5.2-codex[high]");
    expect(composeModelId("sonnet")).toBe("sonnet");
    expect(composeModelId("sonnet", "")).toBe("sonnet");
    const { model, effort } = parseModelId(composeModelId("m", "low"));
    expect(model).toBe("m");
    expect(effort).toBe("low");
  });
});

// ---------------------------------------------------------------------------
// initialize -> image capability
// ---------------------------------------------------------------------------

describe("readImageCapability", () => {
  test("both shipped adapters' advertised shape reads true", () => {
    expect(
      readImageCapability({ agentCapabilities: { promptCapabilities: { image: true, embeddedContext: true } } }),
    ).toBe(true);
  });

  test("absent / malformed reads false (the spec default)", () => {
    expect(readImageCapability({})).toBe(false);
    expect(readImageCapability({ agentCapabilities: {} })).toBe(false);
    expect(readImageCapability(null)).toBe(false);
    expect(readImageCapability({ agentCapabilities: { promptCapabilities: { image: "yes" } } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// session/new -> catalog
// ---------------------------------------------------------------------------

const CLAUDE_INIT = { agentCapabilities: { promptCapabilities: { image: true, embeddedContext: true } } };
const CLAUDE_SESSION = {
  sessionId: "s1",
  models: {
    currentModelId: "default",
    availableModels: [
      { modelId: "default", name: "Default (recommended)", description: "Opus 4.6 · Most capable" },
      { modelId: "opus", name: "Opus", description: "Most capable for complex work" },
      { modelId: "sonnet", name: "Sonnet", description: "Balanced" },
    ],
  },
};

const CODEX_INIT = { agentCapabilities: { promptCapabilities: { image: true, embeddedContext: true } } };
const CODEX_SESSION = {
  sessionId: "t1",
  models: {
    currentModelId: "gpt-5.2-codex[medium]",
    availableModels: [
      { modelId: "gpt-5.2-codex[low]", name: "GPT-5.2 Codex (low)", description: "Fastest." },
      { modelId: "gpt-5.2-codex[medium]", name: "GPT-5.2 Codex (medium)", description: "Balanced." },
      { modelId: "gpt-5.2-codex[high]", name: "GPT-5.2 Codex (high)", description: "Deepest." },
      { modelId: "gpt-5.2[medium]", name: "GPT-5.2 (medium)", description: "General." },
      { modelId: "gpt-5.2[high]", name: "GPT-5.2 (high)", description: "General, deeper." },
    ],
  },
};

describe("mapProviderCatalog", () => {
  test("claude-code: plain aliases map 1:1, NO efforts (degraded-hidden, no fakery)", () => {
    const entry = mapProviderCatalog("claude-code", CLAUDE_INIT, CLAUDE_SESSION);
    expect(entry.title).toBe("Claude Code");
    expect(entry.probed).toBe(true);
    expect(entry.imageSupport).toBe(true);
    expect(entry.models.map((m) => m.id)).toEqual(["default", "opus", "sonnet"]);
    expect(entry.models.every((m) => m.efforts.length === 0)).toBe(true);
    expect(entry.models[0]?.label).toBe("Default (recommended)");
    expect(entry.currentModelId).toBe("default");
    expect(entry.currentEffort).toBeUndefined();
  });

  test("codex: model[effort] variants group by base model with efforts split out", () => {
    const entry = mapProviderCatalog("codex", CODEX_INIT, CODEX_SESSION);
    expect(entry.title).toBe("Codex");
    expect(entry.models.map((m) => m.id)).toEqual(["gpt-5.2-codex", "gpt-5.2"]);
    const codexModel = entry.models[0];
    expect(codexModel?.label).toBe("GPT-5.2 Codex");
    expect(codexModel?.efforts).toEqual(["low", "medium", "high"]);
    // currentModelId gpt-5.2-codex[medium] -> that base's default effort.
    expect(codexModel?.defaultEffort).toBe("medium");
    expect(entry.models[1]?.efforts).toEqual(["medium", "high"]);
    // A base the current id does not match defaults to its first effort.
    expect(entry.models[1]?.defaultEffort).toBe("medium");
    expect(entry.currentModelId).toBe("gpt-5.2-codex");
    expect(entry.currentEffort).toBe("medium");
  });

  test("empty / malformed session degrades to no models, still probed", () => {
    const entry = mapProviderCatalog("claude-code", CLAUDE_INIT, { sessionId: "x" });
    expect(entry.models).toEqual([]);
    expect(entry.probed).toBe(true);
  });

  test("unknown provider keeps its id as the title", () => {
    expect(mapProviderCatalog("my-agent", {}, { sessionId: "x" }).title).toBe("my-agent");
  });

  test("fallbackCatalogEntry is the honest unprobed shape", () => {
    const entry = fallbackCatalogEntry("codex", "spawn failed");
    expect(entry.probed).toBe(false);
    expect(entry.models).toEqual([]);
    expect(entry.note).toBe("spawn failed");
    // Images default ON for unprobed providers (both shipped adapters support them).
    expect(entry.imageSupport).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Images: validation + prompt payload builder
// ---------------------------------------------------------------------------

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("validateChatImage", () => {
  test("a small png passes", () => {
    expect(validateChatImage({ data: PNG_BASE64, mimeType: "image/png" })).toBeUndefined();
  });

  test("unsupported mime type is rejected by name", () => {
    const problem = validateChatImage({ data: PNG_BASE64, mimeType: "application/pdf" });
    expect(problem).toContain("unsupported image type");
  });

  test("non-base64 payload is rejected", () => {
    expect(validateChatImage({ data: "not base64!!!", mimeType: "image/png" })).toContain("base64");
    expect(validateChatImage({ data: "", mimeType: "image/png" })).toContain("base64");
  });

  test("the ~5MB cap rejects oversized images honestly, naming the file", () => {
    // A base64 string whose DECODED size just exceeds the cap.
    const oversized = "A".repeat(Math.ceil((MAX_CHAT_IMAGE_BYTES + 3) / 3) * 4);
    const problem = validateChatImage({ data: oversized, mimeType: "image/png", name: "big.png" });
    expect(problem).toContain("big.png");
    expect(problem).toContain("5MB");
  });

  test("base64ByteSize matches real decoded sizes", () => {
    expect(base64ByteSize(Buffer.from("abc").toString("base64"))).toBe(3);
    expect(base64ByteSize(Buffer.from("abcd").toString("base64"))).toBe(4);
    expect(base64ByteSize(PNG_BASE64)).toBe(Buffer.from(PNG_BASE64, "base64").length);
  });
});

describe("buildPromptBlocks", () => {
  test("text only -> one text block (the historical prompt shape)", () => {
    expect(buildPromptBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  test("text + images -> text first, then ACP image content blocks (base64 + mimeType)", () => {
    const blocks = buildPromptBlocks("look at this", [
      { data: PNG_BASE64, mimeType: "image/png", name: "shot.png" },
    ]);
    expect(blocks).toEqual([
      { type: "text", text: "look at this" },
      { type: "image", data: PNG_BASE64, mimeType: "image/png" },
    ]);
  });

  test("images without text omit the empty text block", () => {
    const blocks = buildPromptBlocks("", [{ data: PNG_BASE64, mimeType: "image/png" }]);
    expect(blocks).toEqual([{ type: "image", data: PNG_BASE64, mimeType: "image/png" }]);
  });
});
