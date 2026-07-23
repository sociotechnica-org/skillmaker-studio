/**
 * The chat-first new-skill launcher (ruled 2026-07-23): a CENTERED panel in
 * the center column -- the whole page stays the stage, the sidebar stays.
 * One compose box styled like the chat's (input on top, provider picker +
 * send circle bottom-right); below it, "Import one of these?" rows listing
 * SKILL.md files the read-only discovery sweep found that aren't bundles
 * yet (GET /api/adopt/candidates; hidden when empty).
 *
 * On SEND: derive a provisional slug from the message (launcher.ts's
 * 3-5-meaningful-words rule, collision-suffixed against the catalog),
 * createSkill via loopApi, then hand off to the shell: navigate to the new
 * skill's page, open the right chat panel, and start a session with the
 * chosen provider whose FIRST prompt is this very message. The launcher
 * disappears -- the conversation continues in the right panel.
 *
 * Serverless astro dev: the panel renders, but send/import are disabled
 * with a quiet note (no candidates, no providers -- nothing to invent).
 */
import { useEffect, useState } from "react";
import { getCatalog } from "../runtime/api.ts";
import { fetchProvidersCatalog, type ChatProviderCatalog } from "./chatApi.ts";
import { deriveSlug, fetchAdoptCandidates, fetchProviders, type AdoptCandidate } from "./launcher.ts";
import { adoptSkill, createSkill } from "./loopApi.ts";
import { defaultSelection, ModelPicker, type ModelSelection } from "./ModelPicker.tsx";
import { FADE_R } from "./ui.tsx";

export function NewSkillLauncher({
  project,
  onCreated,
  onAdopted,
}: {
  readonly project: string;
  /** A skill was created from a first message: navigate + start the chat with it (model implies the provider; absent -> provider default). */
  readonly onCreated: (slug: string, provider: string, message: string, model?: string, effort?: string) => void;
  /** An existing SKILL.md was imported: navigate to it. */
  readonly onAdopted: (slug: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [providers, setProviders] = useState<ReadonlyArray<string> | null | undefined>(undefined);
  const [catalog, setCatalog] = useState<ReadonlyArray<ChatProviderCatalog> | null>(null);
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const [candidates, setCandidates] = useState<ReadonlyArray<AdoptCandidate>>([]);
  const [takenSlugs, setTakenSlugs] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // undefined = still loading, null = server absent (serverless posture).
  const serverless = providers === null;
  const canSend = !serverless && providers !== undefined && !busy && message.trim().length > 0;

  // The grouped model pick (provider-implied); falls back to the first
  // provider when the catalog is absent or still probing.
  const selection: ModelSelection | undefined =
    picked ?? defaultSelection(catalog, providers ?? []) ?? undefined;

  useEffect(() => {
    let cancelled = false;
    void fetchProviders().then((list) => {
      if (cancelled) return;
      setProviders(list);
    });
    void fetchProvidersCatalog().then((entries) => {
      if (!cancelled) setCatalog(entries);
    });
    void fetchAdoptCandidates().then((rows) => {
      if (!cancelled && rows !== null) setCandidates(rows);
    });
    // Collision set for the provisional slug -- best effort; the server's
    // own already_exists answer stays the authority.
    void getCatalog().then(
      (catalog) => {
        if (!cancelled) setTakenSlugs(new Set(catalog.entries.map((entry) => entry.slug)));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const send = async () => {
    const text = message.trim();
    if (text.length === 0 || busy || serverless || providers === undefined) return;
    const chosenProvider = selection?.provider ?? providers[0] ?? "claude-code";
    setBusy(true);
    setError(null);
    const slug = deriveSlug(text, takenSlugs);
    const result = await createSkill(slug, undefined);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    onCreated(result.slug, chosenProvider, text, selection?.model, selection?.effort);
  };

  const importCandidate = async (candidate: AdoptCandidate) => {
    if (busy || serverless) return;
    setBusy(true);
    setError(null);
    const result = await adoptSkill(candidate.path);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    const slug = result.report.adopted[0]?.slug;
    if (slug === undefined) {
      setBusy(false);
      setError("Nothing was adopted.");
      return;
    }
    onAdopted(slug);
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <h1 className="pb-4 text-center font-display text-xl">
          What skill would you like to create? Tell us about it.
        </h1>

        {/* compose box -- same pattern as the chat tab's floating input */}
        <div className="rounded-xl border border-border bg-surface/95 shadow-lg focus-within:border-amber-300">
          <input
            className="w-full bg-transparent px-4 pb-1.5 pt-3.5 text-sm outline-none disabled:opacity-60"
            placeholder={serverless ? "Start the server to create skills" : "A skill that…"}
            value={message}
            disabled={serverless || busy}
            autoFocus
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-end gap-2 px-3 pb-3">
            {selection !== undefined ? (
              <ModelPicker
                catalog={catalog}
                providers={providers ?? []}
                selection={selection}
                onChange={setPicked}
                disabled={serverless || busy}
              />
            ) : (
              <select
                className="max-w-[45%] cursor-default truncate bg-transparent text-xs text-ink-muted outline-none"
                value=""
                disabled
                title="Model for the new skill's session"
              >
                <option value="">model</option>
              </select>
            )}
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-600 text-white shadow hover:bg-amber-700 disabled:opacity-35"
              title="Create the skill and start the conversation"
              disabled={!canSend}
              onClick={() => void send()}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <line x1="8" y1="13" x2="8" y2="3.5" />
                <path d="M4 7.5L8 3.5l4 4" />
              </svg>
            </button>
          </div>
        </div>

        {serverless && (
          <p className="pt-3 text-center text-xs text-ink-muted">
            The studio server isn't running — creating and importing skills needs it.
          </p>
        )}
        {error !== null && <p className="pt-3 text-center text-xs text-red-600">{error}</p>}

        {/* import rows -- hidden entirely when discovery found nothing */}
        {candidates.length > 0 && (
          <section className="pt-6">
            <h2 className="pb-2 text-xs uppercase tracking-widest text-ink-muted">Import one of these?</h2>
            <div className="space-y-1.5">
              {candidates.map((candidate) => (
                <button
                  key={candidate.path}
                  type="button"
                  disabled={busy || serverless}
                  onClick={() => void importCandidate(candidate)}
                  className="flex w-full items-center gap-2 rounded border border-border bg-surface px-3 py-2 text-left text-sm shadow-sm hover:shadow disabled:opacity-60"
                  title={`Import ${candidate.path} into ${project}`}
                >
                  <span className={`min-w-0 flex-1 ${FADE_R}`}>{candidate.path}</span>
                  {candidate.slug !== undefined && (
                    <span className="shrink-0 text-xs text-ink-muted">→ {candidate.slug}</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
