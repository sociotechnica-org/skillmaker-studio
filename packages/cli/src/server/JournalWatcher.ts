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
import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

const DEBOUNCE_MS = 100;

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

  const watchJournalDir = (): void => {
    watcher = watch(dir, (_eventType, changedFilename) => {
      if (changedFilename === null || changedFilename === filename) {
        debounced();
      }
    });
  };

  // `.skillmaker/` not there yet: watch the project root until it appears,
  // then swap to the real watch and tick once (the append that created the
  // directory must broadcast too, not just the ones after it).
  const watchForJournalDir = (): void => {
    watcher = watch(root, (_eventType, changedFilename) => {
      if (closed) return;
      if ((changedFilename === null || changedFilename === dirName) && existsSync(dir)) {
        watcher?.close();
        watchJournalDir();
        debounced();
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
      watcher?.close();
    },
  };
};
