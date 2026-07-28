# Friction log: from-scratch skill (readme-writer)

*2026-07-27. The from-scratch user test, adjusted: not a fresh repo but a
fresh SKILL — director creates a readme-writing skill in the existing
`skills` workspace, end to end through the new shell (tip of main,
post-#170), then uses it on Skillmaker Studio's own README. First
full loop through the product since last week's rebuild.*

*Twin purpose: (a) onboarding/loop friction → requirements, like
docs/friction/to-tickets.md before it; (b) the stage-model verdict —
every place a STAGE concept surfaces (or fails to) gets flagged
`[stage-model]` as evidence for the ladder ruling.*

## Entries

1. **William isn't distributed — every workspace must hand-carry his
   bundles.** Director asked whether `william-draft-skill-md` /
   `william-research-a-skill` still need to live in the project's
   `skills/` dir. They do: `StationEngine.ts` resolves `station.skill`
   ONLY as `<workspace>/skills/<slug>/bundle.json` — no packaged
   fallback. D6 ruled "William + starter skills ship inside the
   product" (adopted Vision card, HOW) but it's unbuilt. A truly fresh
   workspace has no William and the first station fails with a
   precondition error. Related earlier friction: William's bundles
   polluting the Board as skills-under-work (to-tickets test). One
   cause: the product's own operating parts live undifferentiated in
   user space. → Candidate requirement: ship station skills with the
   product (packaged install location + resolution fallback), keep
   workspace-local override for hacking on William himself.
   **→ Fixed same day: PR #171** (packaged copies in
   `packages/cli/skills/`, workspace-wins resolution, drift test,
   shipped in npm tarball + desktop sidecar).

2. **`skillmaker start` silently serves a stale viewer build.** Director
   opened :4323 and got the pre-tab UI — the server was current code but
   `packages/viewer/dist` was built before the redesign. No staleness
   warning, no rebuild hint. npm users are safe (tarball ships matched
   dist); source-checkout users get a quietly old product. → Candidate:
   dev-mode staleness check (dist build stamp vs git HEAD, warn on
   mismatch) or `start --dev` that rebuilds.

3. **"Open full SKILL.md in Files" button was dead.** Overview tab's
   button set NextShell's `fileRequest` state but the prop was never
   passed to RightPanel — dropped wire from the center-panel
   restructure. → Fixed same day on main (5a1ebf6).

4. **Chat model picker shows only sonnet/haiku for claude.** The
   catalog comes verbatim from the adapter's `session/new`, and the
   pinned `@zed-industries/claude-code-acp` is deprecated with a stale
   model list (issue #154's migration, now urgent because it's
   user-visible). Director also ruled: drop GPT models older than the
   gpt-5.6 family from the codex list. → PR in flight
   (fix/154-acp-adapter-migration).

5. **No Windows CLI build on npm** (nor darwin-x64 — Intel Macs). Only
   darwin-arm64 + linux-x64 platform packages exist. → Issue #173 with
   the full recipe; blocker: new npm packages need director-registered
   OIDC trusted publishers.
