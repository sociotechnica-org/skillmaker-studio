/**
 * Fixture-run dispatch from the next shell (agent-first D6: the same
 * engine `skillmaker run <slug> --fixture <case>` drives -- these calls are
 * a door, not a new path):
 *
 *   POST /api/bundles/:slug/run       {fixture}   one fixture
 *   POST /api/bundles/:slug/run-all   {}          every fixture, sequential
 *   GET  /api/bundles/:slug/runs-active           poll while anything runs
 *
 * `useRunDispatch` keeps the two buttons honest with a light poll (every
 * few seconds while runs are active); run outcomes themselves land in the
 * journal and reach the rest of the UI through its existing refetch paths.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface ActiveRun {
  readonly runId: string;
  readonly fixture: string;
  readonly startedAt: string;
  readonly state: "running" | "queued";
}

export interface RunsActive {
  readonly active: ReadonlyArray<ActiveRun>;
  readonly runAll: { readonly completed: number; readonly total: number } | null;
}

const POLL_MS = 3000;

const asError = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // fall through to the generic message
  }
  return `request failed (${response.status})`;
};

export const fetchRunsActive = async (slug: string): Promise<RunsActive> => {
  const response = await fetch(`/api/bundles/${encodeURIComponent(slug)}/runs-active`);
  if (!response.ok) throw new Error(`runs-active: ${response.status}`);
  return (await response.json()) as RunsActive;
};

export const postRun = async (slug: string, fixture: string): Promise<string | null> => {
  const response = await fetch(`/api/bundles/${encodeURIComponent(slug)}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixture }),
  });
  return response.ok ? null : asError(response);
};

export const postRunAll = async (slug: string): Promise<string | null> => {
  const response = await fetch(`/api/bundles/${encodeURIComponent(slug)}/run-all`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return response.ok ? null : asError(response);
};

export interface RunDispatch {
  /** Fixture case names with an active (running or queued) run. */
  readonly activeFixtures: ReadonlySet<string>;
  /** Run-all progress while a sweep is in flight. */
  readonly runAll: { readonly completed: number; readonly total: number } | null;
  /** Last dispatch error, cleared on the next successful dispatch. */
  readonly error: string | null;
  readonly runFixture: (fixture: string) => void;
  readonly runAllFixtures: () => void;
}

/** `slug` may be `""` when the shell runs on placeholders (no server) -- the hook then stays fully inert. */
export function useRunDispatch(slug: string): RunDispatch {
  const [status, setStatus] = useState<RunsActive>({ active: [], runAll: null });
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const poll = useCallback(async () => {
    if (slug.length === 0) return;
    try {
      const next = await fetchRunsActive(slug);
      if (!alive.current) return;
      setStatus(next);
      setWatching(next.active.length > 0 || next.runAll !== null);
    } catch {
      // Server absent (plain astro dev): stay quiet, stop watching.
      if (alive.current) setWatching(false);
    }
  }, [slug]);

  // One poll on mount (picks up runs started elsewhere), then every few
  // seconds only while something is active.
  useEffect(() => {
    void poll();
  }, [poll]);
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [watching, poll]);

  const dispatch = useCallback(
    async (send: () => Promise<string | null>) => {
      if (slug.length === 0) return;
      const failure = await send();
      if (!alive.current) return;
      setError(failure);
      if (failure === null) {
        setWatching(true);
        void poll();
      }
    },
    [poll, slug],
  );

  const runFixture = useCallback((fixture: string) => void dispatch(() => postRun(slug, fixture)), [dispatch, slug]);
  const runAllFixtures = useCallback(() => void dispatch(() => postRunAll(slug)), [dispatch, slug]);

  return {
    activeFixtures: new Set(status.active.map((run) => run.fixture)),
    runAll: status.runAll,
    error,
    runFixture,
    runAllFixtures,
  };
}
