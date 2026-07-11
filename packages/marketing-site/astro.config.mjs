import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Static marketing site: no server, no client framework. One route,
// prerendered HTML. Deploy target (Cloudflare Pages / wrangler) is set up
// separately once auth is in place — this config stays static output.
export default defineConfig({
  output: "static",
  site: "https://skillmaker.studio",
  vite: {
    plugins: [tailwindcss()],
  },
});
