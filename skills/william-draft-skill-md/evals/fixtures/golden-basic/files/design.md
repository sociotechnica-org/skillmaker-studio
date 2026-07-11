---
bundle: add-license-header
---
# Design — Add License Header

## Intent

A file-hygiene skill for a codebase that wants a consistent SPDX license
header on every source file. It exists so contributors (human or agent)
never have to remember the exact header text or forget to add it on new
files -- the skill knows the one canonical header this project uses and
applies it exactly.

## When to use / triggers

Use this skill when asked to add a license header to a file, or to a
directory of files, that does not already have one -- e.g. "add the license
header to src/foo.ts" or "make sure every file in src/ has our license
header."

## The workflow

1. Determine the target file(s) from the request (a single path, or every
   file under a given directory matching the project's source extensions).
2. For each target file, read its first 20 lines and check whether an SPDX
   license header is already present (look for the string
   `SPDX-License-Identifier`).
3. If a header is already present, skip that file -- do not add a second
   header.
4. If no header is present, insert this exact two-line header at the very
   top of the file, above any existing content:
   ```
   // SPDX-License-Identifier: Apache-2.0
   // Copyright (c) 2026 Acme Corp
   ```
5. Report which files were changed and which were skipped (already had a
   header).

## Failure hypotheses

| # | How it could fail | Risk family |
|---|---|---|
| 1 | The skill adds a second header to a file that already has one, instead of skipping it | OUT |
| 2 | The skill inserts the header after existing content (e.g. after a shebang or existing comment) instead of at the very top | OUT |
