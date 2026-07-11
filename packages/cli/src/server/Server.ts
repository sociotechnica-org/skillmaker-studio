/**
 * `skillmaker start`'s server: one `Bun.serve` on one origin serving
 * `/api/*` plus the statically built viewer (`packages/cli/src/server/`,
 * plan.md Phase 3). No CORS, no second origin -- the viewer's runtime
 * client hits same-origin `/api/*` paths.
 */
import { IndexService, IndexServiceLayer, type BundleRecord, type WorkspaceConfig } from "@skillmaker/core";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { watchJournal, type JournalWatcherHandle } from "./JournalWatcher.ts";
import { contentTypeFor, resolveStaticPath } from "./StaticFiles.ts";

const HEARTBEAT_MS = 15_000;

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
