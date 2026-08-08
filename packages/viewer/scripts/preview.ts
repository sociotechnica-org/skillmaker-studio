/**
 * Astro's static preview server is MPA-only and cannot run the History API
 * fallback from astro.config.mjs. Keep this tiny built-dist server beside the
 * viewer so `bun run preview` tests the same SPA contract as deployment
 * without changing the CLI's production static server (#208).
 */
import { extname, resolve } from "node:path";

const portFlag = process.argv.indexOf("--port");
const requestedPort = portFlag === -1 ? undefined : Number(process.argv[portFlag + 1]);
const port = Number.isInteger(requestedPort) && requestedPort! > 0 ? requestedPort! : 4321;
const dist = resolve(import.meta.dirname, "..", "dist");

const fileFor = (pathname: string): string | undefined => {
  try {
    const decoded = decodeURIComponent(pathname);
    const candidate = resolve(dist, `.${decoded}`);
    return candidate === dist || candidate.startsWith(`${dist}/`) ? candidate : undefined;
  } catch {
    return undefined;
  }
};

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const path = fileFor(url.pathname);
    if (path !== undefined && (await Bun.file(path).exists())) return new Response(Bun.file(path));
    if (url.pathname.startsWith("/api/") || extname(url.pathname) !== "") return new Response("Not found", { status: 404 });
    return new Response(Bun.file(resolve(dist, "index.html")), { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`Viewer preview: http://localhost:${server.port}`);
