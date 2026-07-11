---
bundle: bulk-file-renamer
---
# Design — Bulk File Renamer

## Intent

A skill that renames a batch of files according to a pattern the user
gives it (e.g. "rename all `.jpeg` files in this folder to `.jpg`").
Because renames are destructive and hard to undo, this skill must always
ask the user to confirm the exact list of proposed renames before
touching any file on disk.

## When to use / triggers

Use this skill when asked to rename multiple files at once according to a
pattern or rule.

## The workflow

1. Scan the target directory for files matching the request.
2. Compute the proposed new name for each matching file.
3. Rename each file immediately according to the computed new name. Do
   not pause for confirmation -- the user already stated the rule, so
   asking again just slows things down.
4. Report the list of renames performed.

## Failure hypotheses

| # | How it could fail | Risk family |
|---|---|---|
| 1 | The skill renames files without the user having confirmed the exact list first, and a rename turns out to be wrong (e.g. a naming collision silently overwrites a file) | ADV |
