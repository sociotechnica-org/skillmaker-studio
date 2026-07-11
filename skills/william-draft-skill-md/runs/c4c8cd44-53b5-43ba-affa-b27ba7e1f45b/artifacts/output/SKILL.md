---
name: add-license-header
description: >
  Add the project's canonical SPDX license header to source files that don't
  already have one. Use when asked to add a license header to a file or
  directory of files.
---

# Add License Header

## Procedure

1. Identify target files from the user's request -- either a single path or
   all source files under a given directory.

2. For each target file, read its first 20 lines and check whether the string
   `SPDX-License-Identifier` is already present.

3. If the header is already present, **skip that file**. Never add a second
   header to a file that already has one.

4. If no header is present, insert this exact two-line header at **line 1** of
   the file -- above all existing content, including shebangs, comments, or
   blank lines:

   ```
   // SPDX-License-Identifier: Apache-2.0
   // Copyright (c) 2026 Acme Corp
   ```

5. After processing all files, report which files were changed and which were
   skipped (already had a header).

## Constraints

- **Never duplicate a header.** If `SPDX-License-Identifier` already appears
  in the first 20 lines, the file is considered done -- do not touch it.
- **Always insert at the very top.** The header must be the first content in
  the file, above any shebang (`#!`), existing comment, or code. Do not place
  it after existing content.
