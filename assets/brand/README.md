# Brand assets

Single source of truth for the Skillmaker Studio brand assets shared across
the monorepo. **Edit the files here — never the copies under a package's
`public/`.**

## Assets

- `skillmaker-logo.png` — the hand-drawn "SKILLMAKER STUD!O" wordmark. It is a
  black-on-transparent monochrome master: apps paint it in the theme ink colour
  via a CSS `mask` (see `packages/viewer/src/styles/global.css`
  `.skillmaker-logo`), so one file adapts to both light and dark themes. Because
  it's tinted, keep it a single flat silhouette — don't bake in a colour.

## How consumers get it

`scripts/sync-brand-assets.ts` copies each asset here into the `public/` dir of
every consuming app. Those `public/` copies are **generated and gitignored** —
this directory is the only tracked source.

The sync runs automatically before each app's `dev` and `build` (via the
`sync:brand` step in the app's `package.json`), so editing an asset here
propagates everywhere on the next run.

### Adding a consumer

1. Add the app's `public/` path to the asset's `dests` in
   `scripts/sync-brand-assets.ts`.
2. Prepend `bun run sync:brand &&` to that app's `dev` and `build` scripts, and
   add a `sync:brand` script pointing at `../../scripts/sync-brand-assets.ts`.
3. Gitignore the generated `public/` copy.

## Coming next

This is the first step toward centralising brand across the monorepo — logo
first, then shared background/surface tokens, typography, and other brand grabs.
