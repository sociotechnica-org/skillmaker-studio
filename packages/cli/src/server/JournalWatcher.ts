/**
 * Watches `.skillmaker/events.jsonl` for changes and invokes a debounced
 * callback -- the source of `/api/events-stream`'s SSE "journal" messages.
 * Watches the parent directory (not the file directly) so the callback
 * still fires across editors/writers that replace the file rather than
 * appending in place, filtered down to the journal's own filename.
 *
 * Freshness-family fix (2026-08-03): a project registered BEFORE its
 * `.skillmaker/` directory exists (fresh registration, first skill still
 * unborn) used to get NO watcher at all -- the first journal append never
 * broadcast and every live surface stayed stale until reload. Now the
 * watcher falls back to the project root, waits for `.skillmaker/` to
 * appear, then re-attaches to it (and fires once for whatever created it).
 */
import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

const DEBOUNCE_MS = 100;
/** Existence-poll cadence while waiting for .skillmaker/ to be born (platform-independent backstop for lossy dir-creation events). */
const DIR_POLL_MS = 250;
/** Append polling backstop: Bun can miss a write made immediately after fs.watch returns. */
const JOURNAL_POLL_MS = 250;

export interface JournalWatcherHandle {
  readonly close: () => void;
}

export const watchJournal = (journalPath: string, onChange: () => void): JournalWatcherHandle => {
  const dir = dirname(journalPath); // <root>/.skillmaker
  const root = dirname(dir);
  const filename = basename(journalPath);
  const dirName = basename(dir);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const debounced = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      onChange();
    }, DEBOUNCE_MS);
  };

  let watcher: FSWatcher | undefined;
  let journalPoll: ReturnType<typeof setInterval> | undefined;
  const journalStamp = (): string | undefined => {
    try {
      const stat = statSync(journalPath);
      return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return undefined;
    }
  };

  const watchJournalDir = (): void => {
    let stamp = journalStamp();
    watcher = watch(dir, (_eventType, changedFilename) => {
      if (changedFilename === null || changedFilename === filename) {
        stamp = journalStamp();
        debounced();
      }
    });
    // The freshness-family watcher already polls for a just-created
    // `.skillmaker/` directory. This sibling backstop covers the other
    // lossy boundary: an append immediately after `fs.watch` subscribes can
    // arrive before Bun has registered the native watch. Keep the normal
    // event path fast; the stamp check only recovers that missed write.
    journalPoll = setInterval(() => {
      const next = journalStamp();
      if (next !== stamp) {
        stamp = next;
        debounced();
      }
    }, JOURNAL_POLL_MS);
  };

  // `.skillmaker/` not there yet: watch the project root until it appears,
  // then swap to the real watch and tick once (the append that created the
  // directory must broadcast too, not just the ones after it). fs.watch
  // semantics for subdirectory creation differ across platforms (Linux
  // inotify proved lossy here in CI), so a low-frequency existence poll
  // backstops the event — whichever notices first wins, exactly once.
  let poll: ReturnType<typeof setInterval> | undefined;
  const swapToJournalDir = (): void => {
    if (closed || poll === undefined) return;
    clearInterval(poll);
    poll = undefined;
    watcher?.close();
    watchJournalDir();
    debounced();
  };
  const watchForJournalDir = (): void => {
    poll = setInterval(() => {
      if (existsSync(dir)) swapToJournalDir();
    }, DIR_POLL_MS);
    watcher = watch(root, (_eventType, changedFilename) => {
      if (closed) return;
      if ((changedFilename === null || changedFilename === dirName) && existsSync(dir)) {
        swapToJournalDir();
      }
    });
  };

  if (existsSync(dir)) {
    watchJournalDir();
  } else if (existsSync(root)) {
    watchForJournalDir();
  }

  return {
    close: () => {
      closed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (poll !== undefined) {
        clearInterval(poll);
      }
      if (journalPoll !== undefined) {
        clearInterval(journalPoll);
      }
      watcher?.close();
    },
  };
};
