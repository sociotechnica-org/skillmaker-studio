/**
 * Server-side fixture-run dispatch -- the UI's door onto the SAME
 * `RunEngine.runFixture` path the CLI's `skillmaker run` drives (house rule
 * D6: CLI parity first; these endpoints add a door, not a new engine).
 *
 *   POST /api/bundles/:slug/run          {fixture, provider?, model?} -> {runId, status:"running", queued}
 *   POST /api/bundles/:slug/run-all      {provider?, model?}          -> {accepted:true, total, fixtures}
 *   GET  /api/bundles/:slug/runs-active                               -> {active:[{runId,fixture,startedAt,state}], runAll}
 *
 * Dispatch is ASYNC: the response returns immediately with a pre-generated
 * run id; the run's real lifecycle lands in the journal (`run.started`/
 * `run.completed`, appended by RunEngine itself), which the existing
 * `/api/events-stream` SSE already broadcasts (the journal file watcher
 * pings on ANY append) -- clients refetch bundle detail or poll
 * `runs-active`, no new streaming here.
 *
 * Permission policy: runs dispatched here use RunEngine's DEFAULT
 * deny-by-default sandbox policy (`permissive` is never set) -- identical
 * to a plain `skillmaker run` without `--permissive`.
 *
 * CONCURRENCY (documented choice): at most `maxConcurrent` (2)
 * server-dispatched runs execute at once; further dispatches QUEUE (FIFO)
 * rather than 429 -- "run all fixtures" needs ordered queueing anyway, and
 * a queued run is more honest to a button-pressing user than a retry-later
 * error. The queue is bounded in practice by the 409 duplicate guard (one
 * active run per (slug, fixture)).
 *
 * ORPHAN SAFETY (documented choice): the 409 guard is purely in-memory in
 * the server process, so a dead server can never wedge it -- a restart
 * starts clean, and journal-level orphans (run.started with no
 * run.completed, a half-written run dir) remain `skillmaker run repair`'s
 * job, unchanged. Within a live server, every running entry is evicted by
 * a staleness timeout (`staleMs`, default 15 minutes -- comfortably past
 * RunEngine's own 5-minute session timeout plus sandbox setup) in case its
 * promise somehow never settles, so the guard frees itself even if a run
 * fiber is lost.
 */
import { JournalLayer, runFixture, scanFixtures, type WorkspaceConfig } from "@skillmaker/core";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveUserActor } from "../ActorResolver.ts";

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_STALE_MS = 15 * 60 * 1000;

export interface ActiveRunEntry {
  readonly runId: string;
  readonly slug: string;
  readonly fixture: string;
  /** ISO timestamp: when the run started executing (or was enqueued, while `state` is "queued"). */
  readonly startedAt: string;
  readonly state: "running" | "queued";
}

export interface DispatchInput {
  readonly runId: string;
  readonly slug: string;
  readonly fixture: string;
  /** Starts the actual run; the returned promise settling (either way) frees the slot. */
  readonly start: () => Promise<unknown>;
}

export type DispatchOutcome =
  | { readonly ok: true; readonly queued: boolean; readonly done: Promise<void> }
  | { readonly ok: false; readonly reason: "duplicate" };

interface TrackedRun {
  readonly runId: string;
  readonly slug: string;
  readonly fixture: string;
  startedAt: string;
  state: "running" | "queued";
  readonly start: () => Promise<unknown>;
  readonly settle: () => void;
  staleTimer?: ReturnType<typeof setTimeout>;
}

/**
 * The in-memory guard + queue: one active (running or queued) run per
 * (slug, fixture), at most `maxConcurrent` running at once, FIFO beyond.
 * Pure bookkeeping (the actual run is the injected `start` thunk), so it
 * unit-tests without a server.
 */
export class RunDispatcher {
  private readonly entries = new Map<string, TrackedRun>();
  private readonly queue: TrackedRun[] = [];
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly staleMs: number;

  constructor(options?: { readonly maxConcurrent?: number; readonly staleMs?: number }) {
    this.maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
  }

  isActive(slug: string, fixture: string): boolean {
    for (const entry of this.entries.values()) {
      if (entry.slug === slug && entry.fixture === fixture) return true;
    }
    return false;
  }

  dispatch(input: DispatchInput): DispatchOutcome {
    if (this.isActive(input.slug, input.fixture)) {
      return { ok: false, reason: "duplicate" };
    }
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const entry: TrackedRun = {
      runId: input.runId,
      slug: input.slug,
      fixture: input.fixture,
      startedAt: new Date().toISOString(),
      state: "queued",
      start: input.start,
      settle,
    };
    this.entries.set(entry.runId, entry);
    this.queue.push(entry);
    this.pump();
    return { ok: true, queued: entry.state === "queued", done };
  }

  listActive(slug?: string): ReadonlyArray<ActiveRunEntry> {
    const out: ActiveRunEntry[] = [];
    for (const entry of this.entries.values()) {
      if (slug !== undefined && entry.slug !== slug) continue;
      out.push({
        runId: entry.runId,
        slug: entry.slug,
        fixture: entry.fixture,
        startedAt: entry.startedAt,
        state: entry.state,
      });
    }
    return out;
  }

  private pump(): void {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry === undefined) return;
      // A stale-evicted entry may still sit in the queue array; skip ghosts.
      if (!this.entries.has(entry.runId)) continue;
      this.running += 1;
      entry.state = "running";
      entry.startedAt = new Date().toISOString();
      // Staleness backstop: if the start promise never settles (a lost
      // fiber), evict so the guard cannot wedge forever. `unref` (where
      // available) keeps the timer from pinning the process.
      entry.staleTimer = setTimeout(() => this.release(entry.runId), this.staleMs);
      (entry.staleTimer as { unref?: () => void }).unref?.();
      void entry
        .start()
        .catch(() => {
          // The run's own outcome is persisted by RunEngine (run.json +
          // journal); the dispatcher only cares that the slot frees.
        })
        .finally(() => this.release(entry.runId));
    }
  }

  /** Frees a running entry's slot (normal settle OR stale eviction); idempotent. */
  private release(runId: string): void {
    const entry = this.entries.get(runId);
    if (entry === undefined || entry.state !== "running") return;
    if (entry.staleTimer !== undefined) clearTimeout(entry.staleTimer);
    this.entries.delete(runId);
    this.running -= 1;
    entry.settle();
    this.pump();
  }
}

export interface RunAllProgress {
  readonly completed: number;
  readonly total: number;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

interface RunRequestBody {
  readonly fixture?: unknown;
  readonly provider?: unknown;
  readonly model?: unknown;
}

type ParsedBody =
  | { readonly kind: "ok"; readonly body: Record<string, unknown> }
  | { readonly kind: "bad"; readonly error: string };

const parseBody = async (request: Request): Promise<ParsedBody> => {
  const rawText = await request.text();
  if (rawText.length === 0) return { kind: "ok", body: {} };
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { kind: "bad", error: "request body must be a JSON object" };
    }
    return { kind: "ok", body: parsed as Record<string, unknown> };
  } catch {
    return { kind: "bad", error: "invalid JSON body" };
  }
};

export interface RunDispatchHandlers {
  readonly handleRun: (slug: string, request: Request) => Promise<Response>;
  readonly handleRunAll: (slug: string, request: Request) => Promise<Response>;
  readonly handleRunsActive: (slug: string) => Response;
}

/**
 * Builds the three run-dispatch handlers over one shared dispatcher.
 *
 * NOTE (same deliberate limitation as `handleTriggerRun` in Server.ts):
 * prechecks resolve the conventional `<skillsDir>/<slug>` path because
 * `RunEngine.runFixture` itself does -- in-place-adopted bundles can't run
 * until the ENGINE learns locations; the prechecks move with it.
 */
export const createRunDispatchHandlers = (options: {
  readonly root: string;
  readonly config: WorkspaceConfig;
  readonly dispatcher?: RunDispatcher;
}): RunDispatchHandlers => {
  const { root, config } = options;
  const dispatcher = options.dispatcher ?? new RunDispatcher();
  const journalPath = join(root, ".skillmaker", "events.jsonl");
  /** slug -> run-all progress, while a run-all sweep is in flight. */
  const runAllProgress = new Map<string, RunAllProgress>();

  const bundleDirOf = (slug: string): string => join(root, config.skillsDir, slug);

  /** One detached run through the SAME engine path as `skillmaker run` -- sandbox default permission policy, never permissive. */
  const startRun =
    (slug: string, fixture: string, provider: string, model: string | undefined, runId: string) =>
    async (): Promise<unknown> => {
      const actor = await Effect.runPromise(resolveUserActor());
      return Effect.runPromise(
        runFixture({
          root,
          config,
          bundle: slug,
          fixtureCase: fixture,
          provider,
          actor,
          runId,
          ...(model !== undefined ? { model } : {}),
        }).pipe(
          Effect.provide(Layer.provide(JournalLayer(journalPath), BunServices.layer)),
          Effect.provide(BunServices.layer),
          // The run's outcome is already persisted (run.json + journal
          // events) before this Effect resolves; the dispatcher only needs
          // settle-either-way to free the slot.
          Effect.ignore,
        ),
      );
    };

  const validateProviderAndModel = (
    body: Record<string, unknown>,
  ): { readonly provider: string; readonly model: string | undefined } | Response => {
    const rawProvider = (body as RunRequestBody).provider;
    if (rawProvider !== undefined && typeof rawProvider !== "string") {
      return jsonResponse({ error: "provider must be a string" }, 400);
    }
    const provider = typeof rawProvider === "string" ? rawProvider : "claude-code";
    if (config.providers[provider] === undefined) {
      return jsonResponse({ error: `provider "${provider}" is not configured in skillmaker.config.json` }, 400);
    }
    const rawModel = (body as RunRequestBody).model;
    if (rawModel !== undefined && typeof rawModel !== "string") {
      return jsonResponse({ error: "model must be a string" }, 400);
    }
    const model = typeof rawModel === "string" && rawModel.length > 0 ? rawModel : undefined;
    return { provider, model };
  };

  const handleRun = async (slug: string, request: Request): Promise<Response> => {
    const bundleDir = bundleDirOf(slug);
    if (!existsSync(join(bundleDir, "bundle.json"))) {
      return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
    }
    const parsed = await parseBody(request);
    if (parsed.kind === "bad") {
      return jsonResponse({ error: parsed.error }, 400);
    }
    const body = parsed.body;
    const fixture = (body as RunRequestBody).fixture;
    if (typeof fixture !== "string" || fixture.length === 0) {
      return jsonResponse({ error: "fixture is required" }, 400);
    }
    // A case name is a single directory name -- no separators, no dot
    // segments -- so it can never address outside `evals/fixtures/`.
    if (/[/\\]/.test(fixture) || fixture.startsWith(".")) {
      return jsonResponse({ error: `no such fixture "${fixture}" in bundle "${slug}"` }, 404);
    }
    const caseDir = join(bundleDir, "evals", "fixtures", fixture);
    if (!existsSync(join(caseDir, "case.json"))) {
      return jsonResponse({ error: `no such fixture "${fixture}" in bundle "${slug}"` }, 404);
    }
    if (!existsSync(join(caseDir, "prompt.md"))) {
      return jsonResponse({ error: `fixture "${fixture}" has no prompt.md (bundle "${slug}")` }, 409);
    }
    const settings = validateProviderAndModel(body);
    if (settings instanceof Response) return settings;

    const runId = crypto.randomUUID();
    const outcome = dispatcher.dispatch({
      runId,
      slug,
      fixture,
      start: startRun(slug, fixture, settings.provider, settings.model, runId),
    });
    if (!outcome.ok) {
      return jsonResponse({ error: `fixture "${fixture}" already has a run in progress (bundle "${slug}")` }, 409);
    }
    return jsonResponse({ runId, status: "running", queued: outcome.queued }, 202);
  };

  const handleRunAll = async (slug: string, request: Request): Promise<Response> => {
    const bundleDir = bundleDirOf(slug);
    if (!existsSync(join(bundleDir, "bundle.json"))) {
      return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
    }
    const parsed = await parseBody(request);
    if (parsed.kind === "bad") {
      return jsonResponse({ error: parsed.error }, 400);
    }
    const settings = validateProviderAndModel(parsed.body);
    if (settings instanceof Response) return settings;

    // Fixture order = scanFixtures order (sorted directory names), the same
    // enumeration the index and CLI use. Only promptable fixtures run.
    const scanned = await Effect.runPromise(scanFixtures(bundleDir).pipe(Effect.provide(BunServices.layer)));
    const fixtures = scanned.cases.filter((c) => c.hasPromptMd).map((c) => c.caseName);
    if (fixtures.length === 0) {
      return jsonResponse({ error: `bundle "${slug}" has no runnable fixtures (none with prompt.md)` }, 409);
    }
    if (runAllProgress.has(slug) || dispatcher.listActive(slug).length > 0) {
      return jsonResponse({ error: `bundle "${slug}" already has runs in progress` }, 409);
    }

    runAllProgress.set(slug, { completed: 0, total: fixtures.length });
    // Sequential, honest: one fixture at a time, in order, each awaited to
    // completion before the next dispatch. Progress is observable via
    // `runs-active` (the `runAll` field) and the journal's run.* events.
    void (async () => {
      let completed = 0;
      try {
        for (const fixture of fixtures) {
          const runId = crypto.randomUUID();
          const outcome = dispatcher.dispatch({
            runId,
            slug,
            fixture,
            start: startRun(slug, fixture, settings.provider, settings.model, runId),
          });
          if (outcome.ok) {
            await outcome.done;
          }
          completed += 1;
          runAllProgress.set(slug, { completed, total: fixtures.length });
        }
      } finally {
        runAllProgress.delete(slug);
      }
    })();

    return jsonResponse({ accepted: true, total: fixtures.length, fixtures }, 202);
  };

  const handleRunsActive = (slug: string): Response =>
    jsonResponse({
      active: dispatcher
        .listActive(slug)
        .map(({ runId, fixture, startedAt, state }) => ({ runId, fixture, startedAt, state })),
      runAll: runAllProgress.get(slug) ?? null,
    });

  return { handleRun, handleRunAll, handleRunsActive };
};
