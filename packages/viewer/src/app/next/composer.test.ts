import { describe, expect, test } from "bun:test";
import {
  clearDraft,
  draftKey,
  loadDraft,
  pickResumeSession,
  recallScroll,
  rememberScroll,
  saveDraft,
  type DraftStorage,
} from "./composer.ts";

const memoryStorage = (): DraftStorage & { readonly dump: () => Record<string, string> } => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
};

describe("draft persistence", () => {
  test("a saved draft round-trips per skill slug", () => {
    const storage = memoryStorage();
    saveDraft("my-skill", "half-typed steering paragraph", storage);
    expect(loadDraft("my-skill", storage)).toBe("half-typed steering paragraph");
    expect(loadDraft("other-skill", storage)).toBe("");
  });

  test("an empty/whitespace draft removes the stored key", () => {
    const storage = memoryStorage();
    saveDraft("my-skill", "something", storage);
    saveDraft("my-skill", "   ", storage);
    expect(storage.dump()).toEqual({});
    expect(loadDraft("my-skill", storage)).toBe("");
  });

  test("clearDraft drops the stored copy (send path)", () => {
    const storage = memoryStorage();
    saveDraft("my-skill", "about to send", storage);
    clearDraft("my-skill", storage);
    expect(loadDraft("my-skill", storage)).toBe("");
  });

  test("no storage at all (SSR) degrades to empty, never throws", () => {
    expect(loadDraft("my-skill", null)).toBe("");
    expect(() => saveDraft("my-skill", "text", null)).not.toThrow();
  });

  test("keys are namespaced by slug", () => {
    expect(draftKey("a")).not.toBe(draftKey("b"));
  });
});

describe("scroll memory", () => {
  test("remember/recall round-trips per slug; unknown slugs recall null", () => {
    rememberScroll("skill-a", 420);
    expect(recallScroll("skill-a")).toBe(420);
    expect(recallScroll("skill-never-seen")).toBe(null);
  });
});

describe("pickResumeSession", () => {
  test("picks the most recently updated stored session", () => {
    const picked = pickResumeSession([
      { provider: "claude-code", updatedAt: "2026-08-01T10:00:00Z" },
      { provider: "codex", updatedAt: "2026-08-02T10:00:00Z" },
    ]);
    expect(picked?.provider).toBe("codex");
  });

  test("nothing stored: null (the panel shows the start chooser)", () => {
    expect(pickResumeSession([])).toBe(null);
  });

  test("unparseable timestamps sort last but never crash the pick", () => {
    const picked = pickResumeSession([
      { provider: "codex", updatedAt: "garbage" },
      { provider: "claude-code", updatedAt: "2026-08-01T10:00:00Z" },
    ]);
    expect(picked?.provider).toBe("claude-code");
    // ALL garbage still yields an entry -- resuming something beats idling.
    expect(pickResumeSession([{ provider: "codex", updatedAt: "garbage" }])?.provider).toBe("codex");
  });
});
