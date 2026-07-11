---
type: Entity
prefLabel: Read-Out
context: evals
status: migrated
links:
  related_to:
    - "./Capability - Eval Run"
    - "./Component - Answer Key"
---

## WHAT
The graded view of a bundle's eval runs for a chosen (bundle, version): a
viewer surface, not a stored artifact. It joins the risk-map's Coverage
axis against the measurements view per provider/model, lists runs per
fixture with transcript + artifacts inline, and offers a grading panel
(verdict + the fixture's `grading.checks` checklist + notes).

## WHY
Same magic, different storage law. The old model wrote a `read-out.md`
file per campaign — a stored, hand-navigable record. The new model
explicitly makes it "a viewer surface, not a stored artifact" (data-model.md
§2.12): everything it shows is reconstructible from `runs/` + the journal +
the risk-map, so there's nothing to keep in sync and nothing that can go
stale relative to its sources. Grading itself still produces a durable
record — a `run.graded` journal event — the *page* just isn't one.

## HOW
Reconstructed live from: `runs/<run-id>/run.json` + `transcript.jsonl` +
`artifacts/` (files), the `run.graded` journal events (verdict/checks/
notes, latest-wins per run id, full history kept), and the
[[Entity - Risk Map]] × `measurements` join described in
[[Economy - Validation]]. Grading writes exactly one journal event per
grade action:

```jsonc
{ "type": "run.graded",
  "payload": { "id": "01JZX8...", "verdict": "pass" | "fail" | "partial",
               "checks": [{ "text": "...", "pass": true }], "notes": "..." } }
```

Failures are never cleaned up — run records are permanent (law §1.8,
"failures are the curriculum"); a regrade is a new `run.graded` event, not
an edit, so grading history is itself append-only.

A Read-Out is assembled from an [[Capability - Eval Run|Eval Run]]'s
record, graded against the fixture's [[Component - Answer Key]].

Verified: data-model.md §2.12's "viewer surface, not a stored artifact"
framing against `packages/core/src/IndexService.ts`'s `RunIndexRecord`
(carries `verdict`/`gradedAt`/`gradedBy` joined from the latest
`run.graded` event, not a separate file) and the `run.graded` event payload
shape in data-model.md §2.9.
