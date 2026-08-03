/**
 * One journal-events subscription for the whole next shell.
 *
 * The server broadcasts an SSE message on every journal append
 * (`GET /api/events-stream`, see packages/cli/src/server/Server.ts). This
 * module opens a single `EventSource` per page -- shared by every mounted
 * hook -- and turns those messages into debounced "ticks": a station run's
 * burst of appends coalesces into one refetch wave instead of hammering
 * the API once per append.
 *
 * Trailing debounce with a max-wait: each event pushes the trailing timer
 * out, but a sustained stream of appends still ticks at least every
 * `MAX_WAIT_MS` so long runs stay visibly live.
 *
 * Failure posture mirrors the rest of the shell: under serverless
 * `astro dev` the endpoint is absent, the EventSource errors quietly, and
 * hooks behave exactly as today (fetch-on-mount, placeholder fallback).
 * On stream drop we reconnect with capped exponential backoff and emit a
 * single catch-up tick on success -- never a thundering refetch.
 */
import { useEffect, useState } from "react";
import { getActiveProject } from "../runtime/projectScope.ts";

// -- pure part: debounce + backoff (unit-tested in liveRefresh.test.ts) --

export const DEBOUNCE_MS = 400;
export const MAX_WAIT_MS = 2000;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 30_000;

/** Injectable timers so the debounce is testable without real time. */
export interface DebounceTimers {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface Debounced {
  /** Note one upstream event; the emit fires after the quiet period. */
  readonly signal: () => void;
  /** Drop any pending emit (teardown). */
  readonly cancel: () => void;
}

/**
 * Trailing debounce: `emit` fires `debounceMs` after the LAST `signal`,
 * so a burst collapses to one emit -- but never later than `maxWaitMs`
 * after the FIRST signal of the burst, so an unbroken stream of events
 * still surfaces periodically.
 */
export const createTrailingDebounce = (
  emit: () => void,
  { debounceMs = DEBOUNCE_MS, maxWaitMs = MAX_WAIT_MS }: { readonly debounceMs?: number; readonly maxWaitMs?: number } = {},
  // globalThis's clearTimeout overloads don't narrow to (handle: unknown);
  // bind the two functions into the injectable shape instead.
  timers: DebounceTimers = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]),
  },
): Debounced => {
  let trailing: unknown;
  let maxWait: unknown;
  const clear = () => {
    if (trailing !== undefined) {
      timers.clearTimeout(trailing);
      trailing = undefined;
    }
    if (maxWait !== undefined) {
      timers.clearTimeout(maxWait);
      maxWait = undefined;
    }
  };
  const fire = () => {
    clear();
    emit();
  };
  return {
    signal: () => {
      if (trailing !== undefined) timers.clearTimeout(trailing);
      trailing = timers.setTimeout(fire, debounceMs);
      if (maxWait === undefined) maxWait = timers.setTimeout(fire, maxWaitMs);
    },
    cancel: clear,
  };
};

/** Reconnect delay for the nth consecutive failure: 1s, 2s, 4s, ... capped at 30s. */
export const backoffMs = (attempt: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, Math.min(attempt, 30)), BACKOFF_CAP_MS);

/**
 * Does one SSE payload concern the ACTIVE project? Project-tagged payloads
 * (`{"kind":"journal","project":"<slug>"}`) match against the active slug;
 * untagged/unparseable payloads answer `true` -- refetching too eagerly is
 * safe, missing a change is not. Pure (unit-tested).
 */
export const payloadConcernsActive = (data: string, activeProject: string | null): boolean => {
  try {
    const payload = JSON.parse(data) as { readonly project?: unknown };
    if (typeof payload.project === "string" && activeProject !== null && payload.project !== activeProject) {
      return false;
    }
  } catch {
    // not JSON -- concerns everyone
  }
  return true;
};

/** Scope routing for one debounced burst: "all" listeners tick on any append, "active" listeners only when the burst touched the active project. Pure (unit-tested). */
export const scopeWantsBurst = (
  scope: "active" | "all",
  burst: { readonly any: boolean; readonly active: boolean },
): boolean => (scope === "all" ? burst.any : burst.active);

// -- singleton subscription (one EventSource per page) --

/**
 * Which journal appends a listener cares about: `"active"` (default) ticks
 * only for the active project's appends -- right for every project-scoped
 * view; `"all"` ticks for ANY project's appends -- required by the surfaces
 * that render every project at once (Sidebar's project spine, the Board).
 */
export type TickScope = "active" | "all";

const listeners = new Map<() => void, TickScope>();
let source: EventSource | undefined;
let debounced: Debounced | undefined;
let reconnectHandle: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;

// What the current debounce burst saw: any append at all, and whether any
// of them belonged to the active project (or was untagged/unparseable).
let burstAny = false;
let burstActive = false;

const notify = () => {
  const burst = { any: burstAny, active: burstActive };
  burstAny = false;
  burstActive = false;
  for (const [listener, scope] of [...listeners]) {
    if (scopeWantsBurst(scope, burst)) listener();
  }
};

/** Note one upstream event for the debounce, tagged with whether it concerns the active project. */
const signalBurst = (concernsActive: boolean): void => {
  burstAny = true;
  if (concernsActive) burstActive = true;
  debounced?.signal();
};

const connect = (): void => {
  // SSR / test environments have no EventSource; hooks then behave
  // exactly as today (fetch-on-mount only).
  if (typeof EventSource === "undefined") return;
  const stream = new EventSource("/api/events-stream");
  source = stream;
  stream.onopen = () => {
    const recovered = attempt > 0;
    attempt = 0;
    // One catch-up tick after a drop -- anything missed while offline
    // arrives in a single refetch wave, not one per subscriber. Everyone
    // catches up, whatever their scope.
    if (recovered) signalBurst(true);
  };
  stream.onmessage = (event) => {
    // Machine-registry SSE payloads name WHICH project's journal moved
    // (`{"kind":"journal","project":"<slug>"}`, director rulings
    // 2026-07-27): "active"-scoped listeners tick only for the active
    // project's appends; "all"-scoped listeners (Sidebar, Board) tick for
    // every append. Unparseable/legacy payloads tick everyone --
    // refetching too eagerly is safe, missing a change is not.
    signalBurst(payloadConcernsActive(String(event.data), getActiveProject()));
  };
  stream.onerror = () => {
    stream.close();
    if (source !== stream) return; // superseded by teardown/reconnect
    source = undefined;
    if (listeners.size === 0) return;
    const delay = backoffMs(attempt);
    attempt += 1;
    reconnectHandle = setTimeout(connect, delay);
  };
};

const teardown = (): void => {
  if (reconnectHandle !== undefined) {
    clearTimeout(reconnectHandle);
    reconnectHandle = undefined;
  }
  if (source !== undefined) {
    const stream = source;
    source = undefined;
    stream.onerror = null;
    stream.close();
  }
  debounced?.cancel();
  debounced = undefined;
  attempt = 0;
  burstAny = false;
  burstActive = false;
};

/**
 * Subscribe to debounced journal ticks. The first subscriber opens the
 * shared EventSource; the last unsubscriber closes it. Returns the
 * unsubscribe function.
 */
export const subscribeJournalTicks = (listener: () => void, scope: TickScope = "active"): (() => void) => {
  listeners.set(listener, scope);
  if (listeners.size === 1) {
    debounced = createTrailingDebounce(notify);
    connect();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) teardown();
  };
};

/**
 * A number that bumps (debounced) on journal activity. Put it in a fetch
 * effect's dependency list to refetch on journal change; without a server
 * it stays 0 forever. Scope `"all"` for surfaces that render every
 * project's data (Sidebar, Board); default `"active"` for the rest.
 */
export const useJournalTick = (scope: TickScope = "active"): number => {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeJournalTicks(() => setTick((t) => t + 1), scope), [scope]);
  return tick;
};
