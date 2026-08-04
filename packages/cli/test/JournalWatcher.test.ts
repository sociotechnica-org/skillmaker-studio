/**
 * Unit tests for the journal watcher's freshness wiring (2026-08-03 batch):
 * the SSE broadcast source must fire for journal appends AND for the very
 * first append of a project whose `.skillmaker/` directory did not exist
 * when the watcher attached (fresh registration) -- the case that used to
 * leave every live surface stale until reload.
 */
import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchJournal } from "../src/server/JournalWatcher.ts";

const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
};

describe("watchJournal", () => {
  test("fires (debounced) on appends to an existing journal", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-journal-watch-"));
    try {
      const dir = join(root, ".skillmaker");
      mkdirSync(dir);
      const journal = join(dir, "events.jsonl");
      appendFileSync(journal, "{}\n");
      let fired = 0;
      const handle = watchJournal(journal, () => fired++);
      appendFileSync(journal, "{}\n");
      expect(await waitFor(() => fired > 0)).toBe(true);
      handle.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a watcher attached BEFORE .skillmaker exists still broadcasts the first append", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-journal-watch-fresh-"));
    try {
      const journal = join(root, ".skillmaker", "events.jsonl");
      let fired = 0;
      const handle = watchJournal(journal, () => fired++);
      // The first journal write creates the directory and the file -- the
      // exact shape of a fresh project's first skill.
      mkdirSync(join(root, ".skillmaker"));
      appendFileSync(journal, "{}\n");
      expect(await waitFor(() => fired > 0)).toBe(true);

      // ...and later appends keep broadcasting via the re-attached watcher.
      const seen = fired;
      // Give the swap a beat, then append again.
      await new Promise((resolve) => setTimeout(resolve, 150));
      appendFileSync(journal, "{}\n");
      expect(await waitFor(() => fired > seen)).toBe(true);
      handle.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("close() before anything happens never throws, and stops callbacks", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillmaker-journal-watch-close-"));
    try {
      const journal = join(root, ".skillmaker", "events.jsonl");
      let fired = 0;
      const handle = watchJournal(journal, () => fired++);
      handle.close();
      mkdirSync(join(root, ".skillmaker"));
      appendFileSync(journal, "{}\n");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fired).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
