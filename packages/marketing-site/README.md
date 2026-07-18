# @skillmaker/marketing-site

The public marketing/landing site for Skillmaker Studio
(`https://skillmaker.studio` — live on Cloudflare Pages, currently serving
a stale build; see Deploy below).

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

Both `skillmaker.studio` and `docs.skillmaker.studio` are live on
**Cloudflare Pages**, but the deployed build is stale (a pre-#78 era of
the site — it was pushed manually, outside this repo's CI). The
Cloudflare account keys are not on the dev machines here.

A CI deploy exists — `.github/workflows/deploy-sites.yml` — but it is
**dormant** until the account holder configures the repo. Enable
checklist (one-time, ~5 minutes, needs Cloudflare account access):

1. In the Cloudflare dashboard, create an API token scoped to
   **Account → Cloudflare Pages → Edit**.
2. Add two **repo secrets**: `CLOUDFLARE_API_TOKEN` (the token) and
   `CLOUDFLARE_ACCOUNT_ID` (dashboard sidebar).
3. Add three **repo variables**: `CF_PAGES_ENABLED` = `true`,
   `CF_PAGES_PROJECT_SITE` = the Pages project name behind
   skillmaker.studio, and `CF_PAGES_PROJECT_DOCS` = the one behind
   docs.skillmaker.studio.
4. Run the "Deploy sites" workflow once by hand (Actions →
   workflow_dispatch), or merge to main — it fires on any change under
   either site package.

One-off manual alternative, from any machine with account access:

```bash
npx wrangler login
npx wrangler pages deploy packages/marketing-site/dist --project-name=<site-project>
npx wrangler pages deploy packages/docs-site/dist --project-name=<docs-project>
```
