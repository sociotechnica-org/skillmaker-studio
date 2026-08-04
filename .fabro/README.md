# Fabro Software Factory

Fabro factory configuration for Skillmaker Studio, modeled on the working
factory in `alexandria-internal/.fabro/`. This is config-as-code only:
nothing here registers anything with a server or carries credentials.

## Running

The CLI's current default target is the shared Railway Fabro server:

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

## What is NOT done yet

Three defaults were chosen to get a reviewable config; all three are
open to reversal:

1. **Shared server.** This config targets the same Railway Fabro
   instance as alexandria (`fabro-st`) rather than a dedicated one.
   Shared scheduler capacity, shared Daytona quota, and — most
   importantly — the server supports **one active GitHub App config**,
   which today is `fabro-of-alexandria` (GetAlexandria-owned, private,
   so not installable on `sociotechnica-org`). A dedicated server is the
   clean alternative if that constraint bites (see below).
2. **Model/backend copied from ax-feature**: `api` backend, OpenAI
   `gpt-5.5`, medium reasoning (high for scope and the verification
   judge). Nothing in the graph depends on the model; swap freely in
   `workflows/sms-feature/workflow.toml` and `workflow.fabro`.
3. **GitHub App not installed.** The workflow expects a bot with
   `contents: write` and `pull_requests: write` on
   `sociotechnica-org/skillmaker-studio`. Installing it is a
   director-only step; until then, preflight will fail GitHub repository
   access and auto-PR cannot work.

## Director-only: GitHub App install

Mirroring how `fabro-of-alexandria` was set up (see
`alexandria-internal/docs/plans/fabro-setup/plan.md`, "GitHub App
Ownership And Multi-Org Use"):

1. Fabro-generated GitHub Apps are **private**, and a private app can
   only be installed on its owner. So the app must be owned by
   `sociotechnica-org` (register it while acting as that org), e.g.
   named `fabro-of-skillmaker`. `fabro install` opens GitHub with a
   pre-filled app manifest carrying the needed permissions (Contents:
   write, Metadata: read, Pull requests: write, Checks: write).
2. **Constraint:** the Fabro server holds one active
   `[server.integrations.github]` app config. fabro-st currently uses
   `fabro-of-alexandria`. Options, in rough order of preference:
   - Run a dedicated Fabro server for this repo (Railway template is the
     same as fabro-st; reverses default 1).
   - Make one app public and install it on both orgs, then point
     fabro-st at it (upstream manifest hardcodes `"public": false`, so
     this needs a manual app-settings flip after registration).
   - Move fabro-st's app config to a sociotechnica-owned app (breaks the
     alexandria factory; not recommended).
3. On the chosen server, set the app secrets (`GITHUB_APP_CLIENT_SECRET`,
   `GITHUB_APP_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY` — base64 or
   single-line escaped PEM, raw multi-line PEM does not survive the
   env-file format) and the `[server.integrations.github]`
   `app_id`/`client_id`/`slug`.
4. Install the app on `sociotechnica-org/skillmaker-studio` from the
   app's install URL, then confirm with
   `fabro doctor --server …` and `fabro preflight sms-feature …`.
5. Update `[run.git.author]` in `workflows/sms-feature/workflow.toml`
   with the real bot user id
   (`<id>+<slug>[bot]@users.noreply.github.com`).

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
