/**
 * `skillmaker start`'s server: one `Bun.serve` on one origin serving
 * `/api/*` plus the statically built viewer (`packages/cli/src/server/`,
 * plan.md Phase 3). No CORS, no second origin -- the viewer's runtime
 * client hits same-origin `/api/*` paths.
 */
import {
  bundleForEvent,
  checkTransition,
  foldBundleStates,
  foldTodos,
  guardStatus,
  IndexService,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  JournalEvent,
  type BundleRecord,
  type TodoRecord,
  type WorkspaceConfig,
} from "@skillmaker/core";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Schema } from "effect";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { resolveUserActor } from "../ActorResolver.ts";
import { watchJournal, type JournalWatcherHandle } from "./JournalWatcher.ts";
import { contentTypeFor, resolveStaticPath } from "./StaticFiles.ts";

const HEARTBEAT_MS = 15_000;

/**
 * The v1 event catalog (data-model.md §2.9) is much larger than this --
 * `POST /api/events` only ever accepts the subset a human/agent can
 * meaningfully cause from outside the CLI's own scaffolding commands.
 * Everything else (`bundle.created`, `skill.*`, `run.*`, `station.started`)
 * stays CLI/engine-only. `todo.*` joined the allowlist in Phase 5 -- the
 * viewer's todos panel writes directly through this path, same as bundle
 * stage/review actions.
 */
const ALLOWED_API_EVENT_TYPES = new Set([
  "bundle.stage_changed",
  "review.requested",
  "review.resolved",
  "bundle.gate_decided",
  "bundle.archived",
  "bundle.restored",
  "todo.opened",
  "todo.updated",
  "todo.status_changed",
]);

const MAX_BUNDLE_DETAIL_EVENTS = 20;

export interface StartServerOptions {
  readonly root: string;
  readonly config: WorkspaceConfig;
  readonly port: number;
  readonly viewerDist: string;
  readonly version: string;
}

export interface ServerHandle {
  readonly port: number;
  readonly stop: () => Promise<void>;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const runIndexEffect = <A>(
  root: string,
  program: Effect.Effect<A, unknown, IndexService>,
): Promise<A> =>
  Effect.runPromise(
    program.pipe(Effect.provide(Layer.provide(IndexServiceLayer(root), BunServices.layer))),
  );

const listBundleRecords = (root: string): Promise<ReadonlyArray<BundleRecord>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listBundles();
    }),
  );

const getBundleRecord = (root: string, slug: string): Promise<BundleRecord | undefined> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.getBundle(slug);
    }),
  );

const listTodoRecords = (root: string, includeArchived: boolean): Promise<ReadonlyArray<TodoRecord>> =>
  runIndexEffect(
    root,
    Effect.gen(function* () {
      const index = yield* IndexService;
      yield* index.rebuild();
      return yield* index.listTodos({ includeArchived });
    }),
  );

const runJournalEffect = <A>(
  root: string,
  program: Effect.Effect<A, unknown, Journal>,
): Promise<A> =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(Layer.provide(JournalLayer(join(root, ".skillmaker", "events.jsonl")), BunServices.layer)),
    ),
  );

const readJournalEvents = (root: string): Promise<ReadonlyArray<JournalEvent>> =>
  runJournalEffect(
    root,
    Effect.gen(function* () {
      const journal = yield* Journal;
      return yield* journal.readAll();
    }),
  );

interface PostEventRequestBody {
  readonly type?: unknown;
  readonly payload?: unknown;
  readonly idempotencyKey?: unknown;
}

/**
 * `POST /api/events` -- the server-mediated write path (data-model.md
 * §2.9/§2.13): schema-validates against the allowlisted subset of the event
 * catalog, runs the same `Machine.checkTransition` guard the CLI's
 * `advance` command runs, then appends. Rejections are 409s carrying a
 * human-readable reason, not silent failures.
 */
const handlePostEvent = async (root: string, request: Request): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (typeof body !== "object" || body === null) {
    return jsonResponse({ error: "request body must be a JSON object" }, 400);
  }

  const { type, payload, idempotencyKey } = body as PostEventRequestBody;
  if (typeof type !== "string" || !ALLOWED_API_EVENT_TYPES.has(type)) {
    return jsonResponse(
      { error: `event type "${String(type)}" is not accepted by POST /api/events` },
      400,
    );
  }
  if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
    return jsonResponse({ error: "idempotencyKey must be a string" }, 400);
  }

  const actor = await Effect.runPromise(resolveUserActor());

  // Dry-decode against the full event schema (with synthesized envelope
  // fields) to validate the payload shape and recover a typed payload for
  // guard-checking, before the journal's own append-time decode.
  const decodeOutcome = await Effect.runPromise(
    Effect.result(
      Schema.decodeUnknownEffect(JournalEvent)({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        actor,
        ...(typeof idempotencyKey === "string" ? { idempotencyKey } : {}),
        type,
        payload,
      }),
    ),
  );
  if (decodeOutcome._tag === "Failure") {
    return jsonResponse(
      { error: `invalid payload for "${type}": ${String(decodeOutcome.failure)}` },
      400,
    );
  }
  // Envelope fields (id/at/schemaVersion) are discarded -- journal.append
  // regenerates them; this dry-decode only proved the payload valid.
  const { id: _id, at: _at, schemaVersion: _schemaVersion, ...eventInput } = decodeOutcome.success;

  if (eventInput.type === "bundle.stage_changed") {
    const events = await readJournalEvents(root);
    const verdict = checkTransition(events, eventInput.payload);
    if (!verdict.allowed) {
      return jsonResponse({ error: verdict.reason }, 409);
    }
  }

  if (eventInput.type === "todo.updated") {
    const events = await readJournalEvents(root);
    const current = foldTodos(events).get(eventInput.payload.id);
    if (current === undefined) {
      return jsonResponse({ error: `no such todo "${eventInput.payload.id}"` }, 409);
    }
  }

  if (eventInput.type === "todo.status_changed") {
    const events = await readJournalEvents(root);
    const current = foldTodos(events).get(eventInput.payload.id);
    if (current === undefined) {
      return jsonResponse({ error: `no such todo "${eventInput.payload.id}"` }, 409);
    }
    if (current.status !== eventInput.payload.from) {
      return jsonResponse(
        {
          error: `stale "from": todo "${eventInput.payload.id}" is currently "${current.status}", not "${eventInput.payload.from}"`,
        },
        409,
      );
    }
  }

  if (eventInput.type === "review.resolved") {
    const events = await readJournalEvents(root);
    const state = foldBundleStates(events).get(eventInput.payload.bundle);
    if (
      state === undefined ||
      state.substate !== "awaiting-review" ||
      state.stage !== eventInput.payload.state
    ) {
      return jsonResponse(
        {
          error: `bundle "${eventInput.payload.bundle}" is not awaiting review at state "${eventInput.payload.state}"`,
        },
        409,
      );
    }
  }

  try {
    const result = await runJournalEffect(
      root,
      Effect.gen(function* () {
        const journal = yield* Journal;
        return yield* journal.append(eventInput);
      }),
    );
    return jsonResponse({ status: result.status, event: result.event });
  } catch (cause) {
    return jsonResponse({ error: `could not append event: ${String(cause)}` }, 500);
  }
};

/** `GET /api/bundles/:slug` -- the detail/review panel data (data-model.md §2.13). */
const handleBundleDetail = async (root: string, slug: string): Promise<Response> => {
  const bundle = await getBundleRecord(root, slug);
  if (bundle === undefined) {
    return jsonResponse({ error: `no such bundle "${slug}"` }, 404);
  }

  const events = await readJournalEvents(root);
  const bundleEvents = events.filter((event) => bundleForEvent(event) === slug);
  // Newest first, capped at MAX_BUNDLE_DETAIL_EVENTS -- a recent-activity
  // list, not a full history (that's `skillmaker status --json`).
  const recentEvents = bundleEvents.slice(-MAX_BUNDLE_DETAIL_EVENTS).reverse();

  return jsonResponse({
    bundle,
    guardStatus: guardStatus(events, slug),
    events: recentEvents,
  });
};

/**
 * A single set of SSE subscriber "send" functions, broadcast to on journal
 * change and on the heartbeat interval. Scoped per server instance.
 */
const createEventBroadcaster = () => {
  const clients = new Set<(chunk: string) => void>();

  const broadcast = (chunk: string) => {
    for (const send of clients) {
      send(chunk);
    }
  };

  const response = (): Response => {
    const encoder = new TextEncoder();
    let send: (chunk: string) => void = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        send = (chunk: string) => {
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            // Controller already closed by the client disconnecting; the
            // `cancel` callback below removes it from `clients` shortly.
          }
        };
        clients.add(send);
        controller.enqueue(encoder.encode(": connected\n\n"));
      },
      cancel() {
        clients.delete(send);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  };

  return {
    response,
    onJournalChange: () => broadcast("data: journal\n\n"),
    onHeartbeat: () => broadcast(": heartbeat\n\n"),
  };
};

const serveStatic = async (viewerDist: string, pathname: string): Promise<Response> => {
  const resolved = resolveStaticPath(viewerDist, pathname);
  if (resolved === undefined) {
    return new Response("Not Found", { status: 404 });
  }

  const tryFile = (filePath: string): Response | undefined => {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return undefined;
    }
    return new Response(readFileSync(filePath), {
      headers: { "content-type": contentTypeFor(filePath) },
    });
  };

  const direct = tryFile(resolved);
  if (direct !== undefined) {
    return direct;
  }

  // SPA fallback: any non-/api path without a real file falls back to
  // index.html, UNLESS it looks like a real asset request (has a file
  // extension) that's simply missing -- that stays a 404.
  if (extname(pathname).length > 0) {
    return new Response("Not Found", { status: 404 });
  }

  const indexResponse = tryFile(join(viewerDist, "index.html"));
  return indexResponse ?? new Response("Not Found", { status: 404 });
};

export const startServer = (options: StartServerOptions): ServerHandle => {
  const { root, config, port, viewerDist, version } = options;
  const journalPath = join(root, ".skillmaker", "events.jsonl");
  const broadcaster = createEventBroadcaster();

  const watcherHandle: JournalWatcherHandle = watchJournal(journalPath, broadcaster.onJournalChange);
  const heartbeat = setInterval(broadcaster.onHeartbeat, HEARTBEAT_MS);

  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const pathname = url.pathname;

      if (pathname === "/api/health") {
        return jsonResponse({ ok: true, version });
      }

      if (pathname === "/api/state") {
        return jsonResponse({
          workspace: { path: root, name: config.name },
          config: { skillsDir: config.skillsDir, viewerPort: config.viewer.port },
        });
      }

      if (pathname === "/api/bundles") {
        try {
          const bundles = await listBundleRecords(root);
          return jsonResponse({ bundles });
        } catch (cause) {
          return jsonResponse({ error: `could not list bundles: ${String(cause)}` }, 500);
        }
      }

      if (pathname === "/api/events" && request.method === "POST") {
        return handlePostEvent(root, request);
      }

      if (pathname === "/api/todos") {
        try {
          const includeArchived = url.searchParams.get("all") === "1";
          const todos = await listTodoRecords(root, includeArchived);
          return jsonResponse({ todos });
        } catch (cause) {
          return jsonResponse({ error: `could not list todos: ${String(cause)}` }, 500);
        }
      }

      if (pathname.startsWith("/api/bundles/")) {
        const slug = pathname.slice("/api/bundles/".length);
        if (slug.length > 0 && !slug.includes("/")) {
          try {
            return await handleBundleDetail(root, slug);
          } catch (cause) {
            return jsonResponse({ error: `could not load bundle "${slug}": ${String(cause)}` }, 500);
          }
        }
      }

      if (pathname === "/api/events-stream") {
        return broadcaster.response();
      }

      if (pathname.startsWith("/api/")) {
        return jsonResponse({ error: `unknown endpoint ${pathname}` }, 404);
      }

      return serveStatic(viewerDist, pathname);
    },
  });

  return {
    port: server.port ?? port,
    stop: async () => {
      clearInterval(heartbeat);
      watcherHandle.close();
      await server.stop(true);
    },
  };
};
