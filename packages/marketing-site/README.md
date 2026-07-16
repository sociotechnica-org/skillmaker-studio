# @skillmaker/marketing-site

The public marketing/landing site for Skillmaker Studio
(`https://skillmaker.studio` — deploy pending, this package builds the
static site only).

Static Astro 5 site: one route (`/`, the pull-infomercial spine; `/b`
redirects there from the head-to-head era), no client framework, Tailwind v4
via `@tailwindcss/vite`. Copy rationale and rulings live in
[`docs/gtm/2026-07-12-pull-driven-sales/`](../../docs/gtm/2026-07-12-pull-driven-sales/)
(site strategy, voice-of-customer language research, competitor landscape).
Earlier candidate builds (the layer-0 site, the Structure C spine) were
removed 2026-07-16 and survive in git history.

## Scripts

```bash
bun run dev      # astro dev
bun run build    # astro build -> dist/
bun run preview  # astro preview
```

## Deploy

Not wired up yet — no `wrangler.toml`, no CI deploy step. The deliverable
for now is the static `dist/` output; deployment (Cloudflare Pages) is a
follow-up once auth is in place.
