# Fabro Software Factory

Fabro factory configuration for Skillmaker Studio, modeled on the working
factory in `alexandria-internal/.fabro/`. This is config-as-code only:
nothing here registers anything with a server or carries credentials.

## Running

**Decided (director ruling on PR #188):** this repo uses the shared
Railway Fabro server — the same instance as alexandria, and the CLI's
current default target:

- Web UI: `https://fabro-st.up.railway.app/`
- API: `https://fabro-st.up.railway.app/api/v1`

```bash
fabro doctor --server https://fabro-st.up.railway.app
fabro preflight sms-feature \
  --server https://fabro-st.up.railway.app \
  --goal "Describe the feature"
fabro run sms-feature \
  --server https://fabro-st.up.railway.app \
  --goal "Describe the feature"
```

(`--server` is redundant while the CLI's default target is already
fabro-st; it is spelled out so the commands keep working if your local
default changes.)

The `sms-feature` workflow is for approved Skillmaker Studio feature work
in the canonical packages (`packages/core`, `packages/cli`,
`packages/viewer`) and `test/e2e`. Successful non-dry-run runs create a
draft GitHub pull request after finalization because the workflow enables
`[run.pull_request]` — once the GitHub App below is installed.

Factory-machinery changes (this `.fabro/` directory, its scripts and
prompts) never go through `sms-feature` itself; they are operator work,
hand-authored and director-reviewed — same boundary as alexandria's
2026-07-09 ruling.

## Decisions and what is NOT done yet

Director rulings on PR #188:

1. **Shared server: RATIFIED.** This repo runs on `fabro-st`, the same
   Railway Fabro instance as alexandria. The load-bearing consequence:
   the server holds **one active GitHub App config**, which today is
   `fabro-of-alexandria` (GetAlexandria-owned, **private**, so not
   installable on `sociotechnica-org` as-is). With the shared server
   decided, the app strategy must be either an org-owned app made to
   cover BOTH repos, or a server-side config change. The recommended
   route and exact clicks are below — it is the director's next manual
   step.
2. **Models (ruled):** scope and the verification judge run
   `gpt-5.6-sol` at high reasoning; implement, verify, review, and
   prepare-PR run `gpt-5.6-terra` at medium. Set in
   `workflows/sms-feature/workflow.fabro` (per-node) with the terra
   default in `workflow.toml`.
3. **GitHub App not installed yet.** The workflow expects a bot with
   `contents: write` and `pull_requests: write` on
   `sociotechnica-org/skillmaker-studio`. Until the install below is
   done, preflight will fail GitHub repository access and auto-PR
   cannot work.

## Director-only: GitHub App install (next manual step)

Background from how `fabro-of-alexandria` was set up (see
`alexandria-internal/docs/plans/fabro-setup/plan.md`, "GitHub App
Ownership And Multi-Org Use"): Fabro-generated apps start private, a
private app can only be installed on the org that owns it, and fabro-st
can hold only one app config.

**Recommended: make `fabro-of-alexandria` public and install it on this
repo.** It covers both repos with zero server-side config change —
fabro-st already trusts this app, so its `app_id`/`client_id`/secrets
all stay untouched. Exact clicks:

1. GitHub, acting as the `GetAlexandria` org: **Settings → Developer
   settings → GitHub Apps → fabro-of-alexandria**.
2. In the app's left nav choose **Advanced → Make this GitHub App
   public** (the danger-zone toggle; upstream Fabro hardcodes
   `"public": false` in the manifest, so this flip is manual by
   design). Public here means *installable by others*, not that any
   code or secret becomes visible.
3. Open the app's public page
   (`https://github.com/apps/fabro-of-alexandria`) → **Install** →
   choose the `sociotechnica-org` account → **Only select
   repositories** → `skillmaker-studio` → confirm. Requires org-owner
   (or app-manager-approved) rights on sociotechnica-org.
4. No server changes: `[server.integrations.github]` on fabro-st keeps
   the same `app_id`/`client_id`/`slug`, and the existing
   `GITHUB_APP_*` secrets remain valid — installation tokens are minted
   per-installation.
5. Confirm: `fabro doctor --server https://fabro-st.up.railway.app` and
   `fabro preflight sms-feature --server … --goal "smoke"` must pass
   repository access and token minting for
   `sociotechnica-org/skillmaker-studio`.
6. Update `[run.git.author]` in `workflows/sms-feature/workflow.toml`
   to `285810526+fabro-of-alexandria[bot]@users.noreply.github.com`
   (the id alexandria already uses for this app).

Fallbacks, only if making the app public is unacceptable:

- Register a new **public** app owned by either org (e.g.
  `fabro-of-sociotechnica`), install it on both
  `GetAlexandria/alexandria-internal` and
  `sociotechnica-org/skillmaker-studio`, and repoint fabro-st's
  `[server.integrations.github]` + `GITHUB_APP_*` secrets at it. This
  is a server-side config change and briefly interrupts alexandria's
  factory; coordinate the swap.
- A dedicated server for this repo would also work but reverses the
  ratified shared-server ruling; raise it with the director first.

## Local Docker factory: paused

Same reasoning as `alexandria-internal/.fabro/LOCAL_FACTORY_PAUSED.md`:
the retired local path copied a maintainer's reusable agent credentials
into a local Docker image, and no replacement agent-authentication
design has been selected. Do not stand up a local credential-copying
runner for this repo either; the Railway API-backed factory is the only
supported environment. If a local design is ever selected for
alexandria, adopt it here in a reviewed change rather than improvising.

## Source map

- `project.toml` — project metadata: auto-PR (draft), portable default
  environment.
- `workflows/sms-feature/` — the workflow: `workflow.toml` run config,
  `workflow.fabro` graph, `prompts/` per-stage instructions.
- `scripts/fabro-setup-env` — sandbox prepare step: pinned bun install +
  `SKIP_EFFECT_CLONE=1 bun install --frozen-lockfile`.
- `scripts/fabro-validate` — deterministic gate node: typechecks,
  `bun test packages`, `bun test test/e2e`, viewer build when touched;
  mirrors `.github/workflows/ci.yml`.
- `../.repos/fabro` — vendored upstream Fabro source; read-only
  reference for administering the factory.
