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
  const journalSignature = (): string | undefined => {
    try {
      const stat = statSync(journalPath);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return undefined;
    }
  };

  const watchJournalDir = (): void => {
    const beforeWatch = journalSignature();
    watcher = watch(dir, (_eventType, changedFilename) => {
      if (changedFilename === null || changedFilename === filename) {
        debounced();
      }
    });
    // The 2026-08-03 freshness-family guarantee includes the write that races
    // native watcher registration, which Bun can otherwise miss.
    setTimeout(() => {
      if (!closed && journalSignature() !== beforeWatch) debounced();
    }, 0);
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
      watcher?.close();
    },
  };
};
