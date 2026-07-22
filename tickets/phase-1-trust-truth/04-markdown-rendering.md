---
id: 04
title: "Markdown renders wherever .md content is shown"
blocked-by: []
---

## What to build

Anywhere the viewer displays the contents of a markdown file — run
response.md, sandbox artifacts, review-panel file views — the content
renders as formatted markdown with a Raw toggle. Non-markdown files keep
current display.

## Acceptance criteria

- [ ] A .md artifact displays formatted (headings, lists, tables, code fences) with a working Raw toggle
- [ ] Non-.md files do NOT render as markdown
- [ ] Rendered view sanitizes HTML (script/iframe in a fixture-produced .md does not execute — these files are agent-produced, i.e. untrusted)
- [ ] Toggling Raw and back is lossless

## Decisions

- Rendering is client-side in the viewer; pick the repo's existing markdown pathway if one exists (check how SKILL.md/instructions are shown) before adding a dependency.

## Scope fence

No editing (Files-tab editing is Phase 3). No changes to how files are
stored or diffed. Review-panel structure unchanged beyond content
rendering.
