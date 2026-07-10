/**
 * Watches `.skillmaker/events.jsonl` for changes and invokes a debounced
 * callback -- the source of `/api/events-stream`'s SSE "journal" messages.
 * Watches the parent directory (not the file directly) so the callback
 * still fires across editors/writers that replace the file rather than
 * appending in place, filtered down to the journal's own filename.
 */
import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

const DEBOUNCE_MS = 100;

export interface JournalWatcherHandle {
  readonly close: () => void;
}

export const watchJournal = (journalPath: string, onChange: () => void): JournalWatcherHandle => {
  const dir = dirname(journalPath);
  const filename = basename(journalPath);
  let timer: ReturnType<typeof setTimeout> | undefined;

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
  if (existsSync(dir)) {
    watcher = watch(dir, (_eventType, changedFilename) => {
      if (changedFilename === null || changedFilename === filename) {
        debounced();
      }
    });
  }

  return {
    close: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      watcher?.close();
    },
  };
};
