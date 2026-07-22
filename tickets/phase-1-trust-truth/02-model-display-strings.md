---
id: 02
title: "Model names displayed without marketing blurb"
blocked-by: []
---

## What to build

Everywhere the UI or CLI displays a model, show the model name only
("Opus 4.6"); the adapter's full display string ("Opus 4.6 · Most capable
for complex work") appears only in run detail/hover contexts. Stored
values are untouched — this is a display-layer strip of everything after
the first "·" separator (trimmed).

## Acceptance criteria

- [ ] Run rows, measurement cells, and CLI summaries show "Opus 4.6" with no blurb
- [ ] Run detail still exposes the exact full stored string somewhere inspectable
- [ ] Does NOT modify stored run.json/journal model values (verify by diffing a run record before/after)
- [ ] A model string without a "·" separator renders unchanged

## Scope fence

No changes to model extraction/`extractModelTolerant`, no provider
profile changes, no stored-data migration.
