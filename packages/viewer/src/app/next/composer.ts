/**
 * Pure state-keeping for the chat composer (e2e-readiness batch,
 * 2026-08-03): typed-but-unsent drafts survive tab/view switches
 * (localStorage, per skill), the transcript's scroll position survives a
 * remount (module memory -- deliberately NOT persisted across reloads),
 * and the auto-resume pick chooses which stored session a reopened chat
 * panel continues. No React, no fetch -- unit-tested like evals.ts.
 */

/** The subset of Storage the draft helpers need -- injectable for tests. */
export interface DraftStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

const defaultStorage = (): DraftStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export const draftKey = (slug: string): string => `sm-chat-draft-${slug}`;

/** The stored draft for a skill, or "" (never null -- the composer's value). */
export const loadDraft = (slug: string, storage: DraftStorage | null = defaultStorage()): string => {
  try {
    return storage?.getItem(draftKey(slug)) ?? "";
  } catch {
    return "";
  }
};

/** Persist a draft; an empty/whitespace draft removes the key instead of storing noise. */
export const saveDraft = (slug: string, text: string, storage: DraftStorage | null = defaultStorage()): void => {
  try {
    if (text.trim().length === 0) storage?.removeItem(draftKey(slug));
    else storage?.setItem(draftKey(slug), text);
  } catch {
    // Storage full/blocked: losing the persisted copy is the honest floor.
  }
};

export const clearDraft = (slug: string, storage: DraftStorage | null = defaultStorage()): void => {
  try {
    storage?.removeItem(draftKey(slug));
  } catch {}
};

// -- transcript scroll memory (per skill, per page load) ---------------------

const scrollPositions = new Map<string, number>();

/** Remember where the transcript was scrolled when the tab unmounted. */
export const rememberScroll = (slug: string, top: number): void => {
  scrollPositions.set(slug, top);
};

/** The remembered position for a remounting transcript, or null (scroll to bottom as usual). */
export const recallScroll = (slug: string): number | null => scrollPositions.get(slug) ?? null;

// -- auto-resume (director ruling 2026-07-30) --------------------------------

/**
 * Which stored session a freshly opened chat panel resumes automatically:
 * the most recently updated resumable entry. `null` = nothing stored, the
 * panel shows the start chooser. Unparseable timestamps sort last, never
 * crash the pick.
 */
export const pickResumeSession = <T extends { readonly updatedAt: string }>(
  resumable: ReadonlyArray<T>,
): T | null => {
  let best: T | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const entry of resumable) {
    const at = Date.parse(entry.updatedAt);
    const stamp = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
    if (best === null || stamp > bestAt) {
      best = entry;
      bestAt = stamp;
    }
  }
  return best;
};
