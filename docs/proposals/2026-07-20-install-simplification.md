# Install Simplification: Four Doors, One Artifact

*Proposal — Jess, 2026-07-20. Researched against impeccable.style's install flow
and alexandria-internal's installer; all open questions below are ruled.*

## The Ruling

Skillmaker is an application — it owns a workspace, an append-only journal, a
long-running server, and a board UI — so "one install door" undersells it. We
ship **four doors onto the same artifact**, and we take Impeccable's transport
with Alexandria's behavior:

- **Transport from Impeccable**: ride npm. No more bash reimplementing platform
  detection, download, extract, and PATH plumbing (alexandria's `install.sh` is
  465 lines of exactly that — the cautionary tale, not the model). Our
  `install.sh` is frozen as a CI/no-Node fallback; it never grows again.
- **Behavior from Alexandria**: the installer finishes the job — detects the
  context, registers the skill, initializes the workspace, and ends on one
  explicit next action — but that logic lives in the CLI in TypeScript, tested
  like the rest of the product, not in shell script.

| Door | Who it's for | Mechanism |
| --- | --- | --- |
| 1. `npx skillmaker-studio start` | First touch, demos | Zero-install; npm resolves the platform binary |
| 2. `npm i -g skillmaker-studio` / `bun add -g` | Daily driver | Same artifacts, installed once |
| 3. Skillmaker.app | No-terminal persona | Tauri app (built in Phase 15), shipped with auto-update |
| 4. `/skillmaker` skill | Inside Claude Code / Codex | Markdown instructions delegating to the real CLI |

**Build order: CLI first, desktop last.** Phase A (npm packaging) unlocks doors
1, 2, and 4; the desktop app trails everything else.

## npm Namespace (ruled + executed 2026-07-20)

Bare `skillmaker` is **blocked by npm's similarity check** (existing package
`skill-maker`, an unrelated agent-skills tool from 2026-03; there is also
`@huskky/skillmaker`, 2026-05 — the name has been independently invented twice,
worth a GTM-landscape note). Resolution, already executed:

- **`skillmaker-studio`** — the wrapper package users type
  (`npx skillmaker-studio`). Matches the product name, the domain, and the
  GitHub repo. Claimed 2026-07-20 with a minimal real placeholder (v0.0.1
  prints the project blurb + current install path — squat-proof).
- **`@skillmaker/cli`** — org-scoped twin, also claimed as a placeholder;
  candidate home for the real launcher if we ever prefer the scoped form.
- `@skillmaker/cli-darwin-arm64`, `@skillmaker/cli-linux-x64`, … — platform
  packages carrying the compiled binary + `viewer-dist/`, selected by npm via
  the `optionalDependencies` pattern (esbuild/biome style — no postinstall
  download, no runtime network call).
- The **bin name stays `skillmaker`** — after a global install the daily
  command is `skillmaker start`; npx runs the package's single bin regardless
  of the name mismatch.

## The Skill's Command Semantics (ruled)

The `/skillmaker` skill is markdown instructions that **delegate every
state-touching operation to the real CLI** — it never reimplements init/new/
run/grade logic in prose. (This is the split Impeccable's own architecture
draws: its slash commands are pure LLM work, but its deterministic checks run
as a real `npx`-resolved CLI. Everything Skillmaker does is the deterministic
kind.)

- **`/skillmaker init`** — initialize the current directory as a skillmaker
  workspace, **including searching for existing skills in their normal spots**
  (`.claude/skills/`, `~/.claude/skills/`, Codex's equivalents, plus bare
  `SKILL.md` files in the tree) and offering them for adoption via the existing
  `adopt --triage` machinery — the manifest, evidence tripwire, and derived
  entry stage all already exist. Init is not "create empty dirs"; it's "bring
  what you already have into the studio."
- **`/skillmaker new`** — create a new Skill Bundle (`skillmaker new <slug>`).
- Remaining commands (`start`, `run`, `grade`, `ship`, `publish`, …) map 1:1 to
  the CLI surface; the skill documents when to reach for each.

**Harness scope (ruled): Claude Code and Codex only** for v1. Cursor / Copilot
/ Gemini CLI deferred until the first two are solid.

**Registration default (ruled): repo-local.** The skill installs to
`.claude/plugins/skillmaker/` inside a git repo (gitignore hint printed),
`~/.claude/` fallback outside one. Everything in Skillmaker Studio is
repo-local — the workspace journal is already git-tracked; the skill follows
the same law.

Distribution: published through the studio's own `skillmaker publish` →
Claude-marketplace manifest path, so
`/plugin marketplace add sociotechnica-org/skillmaker-studio` works.
Dogfooding: the product distributes itself.

## Desktop App (ruled: yes, with auto-update, no notarization yet, last)

- Ship the existing Tauri app (`packages/desktop`) as a downloadable `.dmg`
  attached to GitHub Releases via a `build-desktop` job
  (`bun run build:desktop` already chains the whole build).
- **Include the Tauri updater plugin** — the app checks a release manifest and
  updates itself in place. "Re-download the dmg" is not the update story.
- **Skip signing/notarization for now** — design partners can right-click-open;
  the Apple Developer Program enrollment and cert-custody overhead is deferred
  until the app proves pull. Revisit before any public "download the app"
  marketing push.
- Scope stays Phase 15's: macOS only.

## Work Items, in Order

**Phase A — npm artifact (unlocks doors 1, 2, 4)**
1. ~~(S) Claim the npm names~~ **Done 2026-07-20**: `skillmaker-studio` and
   `@skillmaker/cli` published as v0.0.1 placeholders.
2. (M) Platform packages: bundle `dist/skillmaker` + `viewer-dist/` into
   `@skillmaker/cli-<platform>` packages; build step beside
   `scripts/build-dist.sh`.
3. (S) Wrapper package `skillmaker` with the optionalDependencies launcher.
4. (M) `release.yml`: `publish-npm` job on `v*` tags, `NPM_TOKEN` secret.
5. (M) **Finish-the-job `skillmaker init`** in `packages/cli`: workspace init +
   the existing-skills sweep (§ command semantics above) + harness detection +
   repo-local skill registration + one-line next action
   (`→ open http://localhost:4323` / `→ type /skillmaker init`).

**Phase B — the `/skillmaker` skill (door 4; starts once A.2–A.3 land)**
6. (M) Author `SKILL.md` per the delegation split; command reference for
   Claude Code, mirrored for Codex.
7. (S) Registration logic shared with A.5 (one code path, in the CLI).
8. (S) Publish via `skillmaker publish`; verify the marketplace-add flow
   end to end.

**Phase C — docs & marketing copy (once real artifacts exist)**
9. (S) docs-site install page: lead `npx skillmaker-studio start` → global → skill →
   app; `curl | sh` demoted to a labeled no-Node/CI fallback.
10. (S) Marketing hero `installLines`: the door-1 command; revisit the
    "ninety seconds" claim against what init now does.
11. (S) Root README quickstart: same ordering.
12. (XS) Uninstall documented for every door.

**Phase D — desktop (last)**
13. (M) `build-desktop` release job producing the `.dmg` (unsigned for now).
14. (M) Tauri updater plugin + release manifest.
15. (S) "Download the app" entry point on the site — added only when 13–14
    ship.

**Trailing, non-blocking**
16. (S) `skillmaker update` / `skillmaker check` subcommands (door-2 parity;
    npx self-updates by nature).
17. (L) Broaden the binary matrix (`darwin-x64`, `linux-arm64`) — same build
    matrix serves npm packages and the frozen curl fallback.

## The Demo (for Danvers)

Fresh terminal + a Claude Code project:

1. Paste `npx skillmaker-studio start` → no PATH edits, no arch errors → browser opens
   on the board (pre-seeded workspace so it isn't an empty state).
2. In Claude Code: `/skillmaker init` → the skill sweeps the project's existing
   `.claude/skills/`, offers the triage manifest, mints bundles — and they
   appear on the still-open board live (SSE, already true today).
3. `/skillmaker new my-skill` → a new bundle lands on the board.

Zero-install → running application → agent-native control of the same state.
The persistent board is the beat Impeccable can't do — the "not an exact fit"
is the pitch.

## Rulings Log (all former open questions)

- npm name: bare `skillmaker` blocked by npm similarity check (`skill-maker`
  exists) → **`skillmaker-studio` claimed and published 2026-07-20**, with
  `@skillmaker/cli` as the scoped twin; org `@skillmaker` holds platform
  packages; bin stays `skillmaker`.
- Desktop app: ship it, with in-app auto-update; **no notarization yet**;
  built **last**, after the CLI doors.
- Harnesses: **Claude Code + Codex** only in v1.
- Skill registration: **repo-local by default** — everything in SMS is
  repo-local.
- `/skillmaker init` = initialize this directory **and adopt what's already
  here** (normal skill locations swept via `adopt --triage`).
- `/skillmaker new` = new Skill Bundle.
- Priority: **CLI first, desktop last**; `install.sh` frozen.
