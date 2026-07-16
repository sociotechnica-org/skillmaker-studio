import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Static marketing site: no server, no client framework. One route,
// prerendered HTML. Deploy target (Cloudflare Pages / wrangler) is set up
// separately once auth is in place — this config stays static output.
// The /b redirect covers links from the 2026-07 head-to-head era, when the
// infomercial spine lived at /b before being promoted to the root.
export default defineConfig({
  output: "static",
  site: "https://skillmaker.studio",
  redirects: {
    "/b": "/",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
