/**
 * Sidebar presence: which skills have something RUNNING right now.
 *
 * "Running" (ruled 2026-07-23, both signals implemented in v1) =
 *   1. an active dispatched fixture run -- `GET /api/bundles/:slug/runs-active`
 *      (RunDispatch.ts's in-memory dispatcher state, no index rebuild), OR
 *   2. an active chat session whose status is "running" --
 *      `GET /api/chat/:slug/state` (ChatSessionManager's in-memory state,
 *      also no index rebuild).
 *
 * Both endpoints are cheap in-memory reads server-side, so the sweep polls
 * BOTH rather than settling for run-detection alone. Cost discipline:
 *   - one aggregate sweep per journal tick (the tick is already debounced,
 *     liveRefresh.ts), never one fetch per subscriber;
 *   - plus a slow heartbeat (`HEARTBEAT_MS`) ONLY while something is
 *     running -- a chat turn's start/end appends no journal event, so
 *     without it a finished spinner would stick until the next append;
 *   - bounded to the first `MAX_SWEEP` slugs handed in (the sidebar passes
 *     only the open project's visible rows);
 *   - one total failure (server absent, plain astro dev) disables the hook
 *     for the component's lifetime -- no retry hammering.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeJournalTicks } from "./liveRefresh.ts";

export const MAX_SWEEP = 20;
export const HEARTBEAT_MS = 6000;

/** The `runs-active` fields presence reads (decoded defensively). */
export type RunsActiveGlance = { readonly active?: ReadonlyArray<unknown> } | null;
/** The chat-state fields presence reads (decoded defensively). */
export type ChatStateGlance = { readonly active?: { readonly status?: unknown } | null } | null;

/**
 * The presence verdict for one skill, pure (unit-tested): running when any
 * dispatched run is active OR the live chat session reports "running".
 * `null` inputs (endpoint absent/failed) contribute nothing -- a missing
 * signal is silence, never a spinner.
 */
export const isRunning = (runs: RunsActiveGlance, chat: ChatStateGlance): boolean => {
  const activeRuns = runs !== null && Array.isArray(runs.active) && runs.active.length > 0;
  const chatRunning =
    chat !== null &&
    typeof chat.active === "object" &&
    chat.active !== null &&
    chat.active.status === "running";
  return activeRuns || chatRunning;
};

const fetchGlance = async (path: string): Promise<unknown | null> => {
  try {
    const response = await fetch(path, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

/** One aggregate sweep: both signals for every slug (bounded), in parallel. */
const sweepPresence = async (slugs: ReadonlyArray<string>): Promise<ReadonlySet<string>> => {
  const bounded = slugs.slice(0, MAX_SWEEP);
  const verdicts = await Promise.all(
    bounded.map(async (slug) => {
      const [runs, chat] = await Promise.all([
        fetchGlance(`/api/bundles/${encodeURIComponent(slug)}/runs-active`),
        fetchGlance(`/api/chat/${encodeURIComponent(slug)}/state`),
      ]);
      if (runs === null && chat === null) return { slug, running: false, reachable: false };
      return {
        slug,
        running: isRunning(runs as RunsActiveGlance, chat as ChatStateGlance),
        reachable: true,
      };
    }),
  );
  // Every endpoint unreachable = the server is absent; signal via a
  // sentinel so the hook can stop sweeping entirely.
  if (verdicts.length > 0 && verdicts.every((verdict) => !verdict.reachable)) {
    throw new Error("presence: server absent");
  }
  return new Set(verdicts.filter((verdict) => verdict.running).map((verdict) => verdict.slug));
};

/**
 * Slugs with something running, for the sidebar's row spinners. Sweeps on
 * each (debounced) journal tick; while anything is running, also on a slow
 * heartbeat so ends that append nothing (chat turns) still clear. Fully
 * inert after the first all-endpoints-unreachable sweep (serverless astro
 * dev) and when `slugs` is empty.
 */
export function usePresence(slugs: ReadonlyArray<string>): ReadonlySet<string> {
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const disabled = useRef(false);
  const inFlight = useRef(false);
  // Identity-stable key so effects don't loop on a fresh array each render.
  const key = slugs.join("\n");

  useEffect(() => {
    let cancelled = false;
    const list = key.length === 0 ? [] : key.split("\n");

    const sweep = () => {
      if (disabled.current || inFlight.current || list.length === 0) return;
      inFlight.current = true;
      sweepPresence(list)
        .then((next) => {
          if (!cancelled) setRunning(next);
        })
        .catch(() => {
          disabled.current = true;
          if (!cancelled) setRunning(new Set());
        })
        .finally(() => {
          inFlight.current = false;
        });
    };

    sweep();
    const unsubscribe = subscribeJournalTicks(sweep);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key]);

  // Heartbeat only while spinners are visible: catches endings that never
  // touch the journal without polling an idle workspace forever.
  const anyRunning = running.size > 0;
  useEffect(() => {
    if (!anyRunning || disabled.current) return;
    const list = key.length === 0 ? [] : key.split("\n");
    const timer = setInterval(() => {
      if (disabled.current || inFlight.current || list.length === 0) return;
      inFlight.current = true;
      sweepPresence(list)
        .then(setRunning)
        .catch(() => {
          disabled.current = true;
          setRunning(new Set());
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [anyRunning, key]);

  return useMemo(() => running, [running]);
}
