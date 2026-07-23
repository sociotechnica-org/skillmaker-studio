/**
 * The chat-first new-skill launcher's data layer (ruled 2026-07-23):
 *
 * - `deriveSlug`: a provisional slug from the user's first message --
 *   slugify 3-5 meaningful words (stopwords dropped), `-2`-suffixed on
 *   collision with slugs the workspace already holds. Pure, unit-tested;
 *   the server remains the authority (createSkill reports `already_exists`
 *   honestly if the workspace changed under us).
 * - `fetchAdoptCandidates`: `GET /api/adopt/candidates` -- the read-only
 *   adopt-triage discovery sweep (core's `walk`, issue #92) exposed as
 *   "SKILL.md files in this project that aren't bundles yet". Decoded
 *   defensively; any failure resolves to `null` (server absent -> the
 *   launcher hides the import section and disables send).
 * - `fetchProviders`: the configured agent providers off `GET /api/state`
 *   (the same list the chat surface's picker shows), `null` when serverless.
 */
import { getState } from "../runtime/api.ts";

// ---------------------------------------------------------------------------
// Slug derivation (pure)
// ---------------------------------------------------------------------------

/**
 * Words that carry no naming signal in a "make me a skill that..." message.
 * Deliberately small: over-filtering risks empty slugs more than
 * under-filtering risks clunky ones (the user can rename later; the message
 * itself is preserved as the session's first prompt either way).
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "this", "that", "these", "those", "it", "its",
  "i", "we", "you", "me", "us", "my", "our", "your",
  "and", "or", "but", "so", "if", "then", "than", "as",
  "to", "of", "in", "on", "at", "by", "for", "from", "with", "into", "onto", "about",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "can", "could", "would", "should", "will", "shall", "may", "might", "must",
  "want", "wants", "need", "needs", "like", "help", "please", "let", "lets",
  "make", "makes", "create", "creates", "build", "builds", "write", "writes",
  "skill", "skills", "new", "some", "any", "all", "when", "how", "what", "which", "who", "there",
]);

const MAX_SLUG_WORDS = 5;
const MIN_SLUG_WORDS = 3;

/** The message's words, lowercased, punctuation stripped, order preserved. */
const wordsOf = (message: string): ReadonlyArray<string> =>
  message
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word.length > 0);

/**
 * A slug base from the message: the first 3-5 MEANINGFUL words (stopwords
 * dropped). When fewer than 3 meaningful words exist, raw words backfill in
 * original order so short messages still name something; a message with no
 * usable words at all falls back to "new-skill".
 */
export const slugBaseFromMessage = (message: string): string => {
  const all = wordsOf(message);
  const meaningful = all.filter((word) => !STOPWORDS.has(word));
  let picked = meaningful.slice(0, MAX_SLUG_WORDS);
  if (picked.length < MIN_SLUG_WORDS) {
    // Backfill from the raw word stream, keeping original order and
    // skipping words already picked.
    const chosen = new Set(picked);
    for (const word of all) {
      if (picked.length >= MIN_SLUG_WORDS) break;
      if (chosen.has(word)) continue;
      chosen.add(word);
      picked = [...picked, word];
    }
    picked = [...picked].sort((left, right) => all.indexOf(left) - all.indexOf(right));
  }
  return picked.length === 0 ? "new-skill" : picked.join("-");
};

/** `base`, or `base-2`, `base-3`, ... -- the first not in `taken`. */
export const uniquifySlug = (base: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
};

/** The launcher's provisional slug for a first message, collision-free against `taken`. */
export const deriveSlug = (message: string, taken: ReadonlySet<string>): string =>
  uniquifySlug(slugBaseFromMessage(message), taken);

// ---------------------------------------------------------------------------
// Adopt candidates (GET /api/adopt/candidates)
// ---------------------------------------------------------------------------

/** One not-yet-adopted SKILL.md found by the discovery sweep. */
export type AdoptCandidate = {
  /** Project-relative path to the SKILL.md file (what `POST /api/adopt` takes). */
  readonly path: string;
  /** The provisional slug an adopt would assign -- a preview, not a reservation. */
  readonly slug: string | undefined;
};

/** `{candidates: [...]}` -> the rows, or `null` when the payload isn't that shape (exported for tests). */
export const decodeCandidatesResponse = (json: unknown): ReadonlyArray<AdoptCandidate> | null => {
  if (typeof json !== "object" || json === null) return null;
  const raw = (json as { readonly candidates?: unknown }).candidates;
  if (!Array.isArray(raw)) return null;
  const rows: AdoptCandidate[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { path, slug } = entry as { readonly path?: unknown; readonly slug?: unknown };
    if (typeof path !== "string" || path.length === 0) continue;
    rows.push({ path, slug: typeof slug === "string" && slug.length > 0 ? slug : undefined });
  }
  return rows;
};

/** Candidates, or `null` on any failure (server absent, bad payload). */
export const fetchAdoptCandidates = async (): Promise<ReadonlyArray<AdoptCandidate> | null> => {
  try {
    const response = await fetch("/api/adopt/candidates", { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return decodeCandidatesResponse(await response.json());
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Providers (GET /api/state)
// ---------------------------------------------------------------------------

/** Configured agent provider ids for the compose box's picker, `null` when the server is absent. */
export const fetchProviders = async (): Promise<ReadonlyArray<string> | null> => {
  try {
    const state = await getState();
    return state.config.providers;
  } catch {
    return null;
  }
};
