---
id: 01
title: "Deny-by-default permission policy for run/station agents"
blocked-by: []
---

## What to build

When a run or station agent asks for permission, the engine stops
auto-approving everything. Requests whose effect stays inside the sandbox
directory are allowed; anything reaching outside it is denied. Every
decision — allowed or denied, with the reason — appears in the transcript
and the CLI progress output, so a denial is diagnosable from one run. A
per-invocation `--permissive` flag restores the old approve-everything
behavior as the escape hatch while we learn what legitimate agent work
gets denied (director wants to "find out" safely).

Interim stance for issue #137. OS-level sandboxing is a later, separate
ticket.

## Acceptance criteria

- [ ] A permission request to write/read inside the sandbox dir is allowed and the transcript records the decision with its reason
- [ ] A permission request reaching outside the sandbox dir is denied; the run continues (denial is not a crash) and the CLI prints a visible denial line
- [ ] Does NOT change behavior under `--permissive`: all requests approved, decisions still recorded
- [ ] Re-running the same fixture twice produces the same decisions (policy is deterministic)
- [ ] Existing e2e suite passes with the new default

## Decisions

- Policy location: `AcpClient` option supplied by `RunEngine`/`StationEngine` (replaces the bare `decidePermission` fallback).
- CLI: `skillmaker run <slug> --fixture <case> --permissive` and `skillmaker station run <slug> --permissive`.
- Denial wire shape: choose the ACP option whose `kind` is reject/deny; if none offered, respond with the least-permissive offered option and record that compromise in the transcript.

## Scope fence

No OS sandboxing, no network filtering, no per-tool allowlists, no UI.
Does not touch the chat/D9 design. Policy inputs are only: sandbox dir
path + request payload.
