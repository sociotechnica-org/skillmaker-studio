---
title: skillmaker todo
description: The journal-native todo system — add, list, done, start, drop, reopen.
---

Todos are journal-native work-tracking entities — the same append-only,
replayable model as everything else in a Skillmaker workspace, independent
of any bundle's production stage.

## `todo add`

```text
skillmaker todo add <title> [--kind <kind>] [--bundle <slug>] [--detail <text>] [--priority <n>] [--pin]
```

| Flag | Meaning |
|---|---|
| `--kind <kind>` | `task \| bug \| improvement \| eval`; defaults to `task` |
| `--bundle <slug>` | Associate the todo with a bundle (app-level todos omit it) |
| `--detail <text>` | Free-text detail |
| `--priority <n>` | Lower = more urgent; defaults by kind: `bug` 10, `eval` 15, `improvement` 20, `task` 30 |
| `--pin` | Pin the todo (exempt from auto-archive) |

```sh
skillmaker todo add "Write the intent section" --kind task --bundle my-first-skill
```

```text
skillmaker: opened todo td-7a89db80-019f-4868-b736-e349aa725a8e — Write the intent section
```

## `todo list`

```text
skillmaker todo list [--bundle <slug>] [--all]
```

Rebuilds the index, then lists todos sorted priority → created → id.
`--all` includes archived todos (terminal + at least 7 days old + not
pinned — derived at replay, never stored).

```text
ID                                       KIND  STATUS  PRIO  TITLE
td-7832df6a-b7e8-436b-890c-9cba60fe88b7  bug   done    10    Second todo
td-7a89db80-019f-4868-b736-e349aa725a8e  task  open    30    Write the intent section (my-first-skill)
```

## `todo done` / `todo start` / `todo drop` / `todo reopen`

```text
skillmaker todo done <id>
skillmaker todo start <id>
skillmaker todo drop <id>
skillmaker todo reopen <id>
```

Status transitions. `done` and `wont-do` (`drop`) are terminal — a terminal
todo stamps `terminalAt`, which `reopen` clears. `start` moves an `open`
todo to `in-progress`.

```sh
skillmaker todo start td-7832df6a-b7e8-436b-890c-9cba60fe88b7
```

```text
skillmaker: todo td-7832df6a-b7e8-436b-890c-9cba60fe88b7 moved from "open" to "in-progress"
```

```sh
skillmaker todo done td-7832df6a-b7e8-436b-890c-9cba60fe88b7
```

```text
skillmaker: todo td-7832df6a-b7e8-436b-890c-9cba60fe88b7 moved from "in-progress" to "done"
```

## See also

The viewer has an equivalent todos panel driven by the same journal events
— either door produces identical state on `todo list` / `reindex`.
