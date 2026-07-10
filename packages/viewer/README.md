# @skillmaker/viewer

The Skillmaker Studio viewer: **Astro 5 + `@astrojs/react` (React 19) +
Tailwind v4** — one real Astro page (`src/pages/index.astro`) mounting a
client-routed React app (`src/app/`), served statically by `skillmaker
start` alongside `/api/*` on one origin (`packages/cli/src/server/`).

- `src/app/runtime/` — the typed client boundary: `fetch` -> `Schema`
  decode (`effect`, decode-only) -> tagged errors -> hooks. `effect` stays
  confined to this directory; components are plain React + Tailwind.
- `src/app/components/` — the Board page (the only route in Phase 3): six
  columns (idea / researching / drafting / evaluating / published /
  archived), live via SSE (`/api/events-stream`).

```sh
bun run build        # astro build -> dist/ (also: `bun run build:viewer` from the repo root)
bun run dev           # astro dev, with a dev-only SPA fallback so routing matches prod
bun run check         # astro check
```
