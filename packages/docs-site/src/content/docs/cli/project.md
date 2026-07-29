---
title: skillmaker project
description: Register, list, and unregister projects in the machine-level registry.
---

```text
skillmaker project add <path>
skillmaker project list
skillmaker project remove <path>
```

The CLI door onto the **machine-level project registry** — the list of
project directories [`skillmaker start`](/cli/start/) serves, stored at
`~/.skillmaker-studio/config.json` (`SKILLMAKER_STUDIO_HOME` overrides the
home directory). The registry is only a list of directory paths; everything
about a project — its `skillmaker.config.json`, `skills/`, journal — stays
in the project directory itself, so cloning a project's repo still carries
its skills and their evidence along.

Projects can equally be added from the viewer's sidebar (**New project**,
which can also browse for or create a directory and initialize it) — the
CLI and the UI write the same registry file.

## `project add`

```text
skillmaker project add <path>
```

Registers an **existing** skillmaker workspace (a directory with a
`skillmaker.config.json` — run [`skillmaker init`](/cli/init/) there
first). It never scaffolds; a non-workspace directory is refused with a
pointer to `init`:

```text
skillmaker project add: "/path/to/dir" is not a skillmaker workspace (no skillmaker.config.json -- run `skillmaker init` there first)
```

Adding an already-registered path reports `already registered` and changes
nothing. A running `skillmaker start` picks the new project up without a
restart.

```text
skillmaker: registered /Users/alice/code/my-skills
```

## `project list`

```text
skillmaker project list
```

Lists every registered project with its URL slug (the `:project` segment in
the server's `/api/projects/:project/...` routes), health, and path:

```text
SLUG       STATUS   PATH
my-skills  ok       /Users/alice/code/my-skills
client-w   broken   /Users/alice/code/client-w
```

`broken` means the directory is missing or no longer looks like a
skillmaker workspace — reported per-project, never crashed over. A
project's slug is derived from its directory basename; when two registered
paths share a basename, each collider gets a short content-hash suffix so
slugs stay stable regardless of registration order.

## `project remove`

```text
skillmaker project remove <path>
```

Unregisters a path — it **never touches the directory itself**:

```text
skillmaker: unregistered /Users/alice/code/my-skills (the directory itself is untouched)
```

The path doesn't have to still exist on disk; unregistering a deleted or
moved project is the main use.

## Options

| Flag | Meaning |
|---|---|
| `--json` | Emit machine-readable JSON instead of text (`list` includes the registry's home directory) |

## See also

[`skillmaker start`](/cli/start/) serves the registry;
[`skillmaker init`](/cli/init/) makes a directory registrable in the first
place. [Your first Skill Bundle](/getting-started/first-bundle/) walks
`init` → `project add` → `start` end to end.
