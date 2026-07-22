---
id: 03
title: "Transcript coalescing: streaming chunks become paragraphs"
blocked-by: []
---

## What to build

The run read-out's transcript merges consecutive same-role agent text
chunks into single prose blocks (paragraph breaks preserved), instead of
one row per streamed fragment with mid-sentence breaks. Tool calls,
permission decisions, and role changes still start fresh rows.

## Acceptance criteria

- [ ] A streamed agent reply renders as one coherent block, not N fragment rows
- [ ] Tool-call and permission rows are NOT merged into prose blocks
- [ ] Transcript ordering is unchanged (coalescing never reorders entries)
- [ ] Re-opening the same run renders identically (pure render-time transform; transcript.jsonl untouched)

## Scope fence

Render-time only — no changes to transcript writing, AcpClient, or
stored formats. No markdown rendering (separate ticket).
