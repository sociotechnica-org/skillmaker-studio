# @skillmaker/marketing-site

The public marketing/landing site for Skillmaker Studio
(`https://skillmaker.studio` — deploy pending, this package builds the
static site only).

Static Astro 5 site: one route (`/`), no client framework, Tailwind v4 via
`@tailwindcss/vite`. Copy is sourced from
[`docs/plans/2026-07-10-playmaker-to-skillmaker-migration/marketing-copy.md`](../../docs/plans/2026-07-10-playmaker-to-skillmaker-migration/marketing-copy.md).

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
