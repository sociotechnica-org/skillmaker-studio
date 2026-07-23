import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Phase 3 has exactly one route ("/"), rendered by a client-routed React
// app. In production, `packages/cli`'s static server does the SPA fallback
// (any non-/api GET -> index.html). This Vite plugin gives `astro dev` the
// same behavior, so dev and prod routing match (per the phase-3 build
// brief): any GET that isn't for a real file, an Astro-internal path, or
// /api/* is rewritten to "/" before Astro's own router sees it.
const devSpaFallback = () => ({
  name: "skillmaker-dev-spa-fallback",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      const url = req.url ?? "/";
      const pathname = url.split("?")[0] ?? "/";
      const isApi = pathname.startsWith("/api/");
      const isViteInternal = pathname.startsWith("/@") || pathname.startsWith("/src/");
      const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname);
      if (!isApi && !isViteInternal && !hasFileExtension && pathname !== "/") {
        req.url = "/";
      }
      next();
    });
  },
});

export default defineConfig({
  devToolbar: { enabled: false },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss(), devSpaFallback()],
  },
});
