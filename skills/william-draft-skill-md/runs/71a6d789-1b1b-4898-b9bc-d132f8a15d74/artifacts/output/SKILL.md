---
name: add-license-header
description: >
  Add the project's canonical SPDX license header to source files that are
  missing one. Use when asked to add a license header to a file or directory,
  e.g. "add the license header to src/foo.ts" or "make sure every file in
  src/ has our license header."
---

Follow this procedure exactly.

1. **Identify targets.** From the user's request, determine the file(s) to
   process -- either a single path or every source file under a given
   directory.

2. **Check each file for an existing header.** Read the first 20 lines and
   look for the string `SPDX-License-Identifier`.

3. **Skip files that already have a header.** If `SPDX-License-Identifier`
   appears in the first 20 lines, do NOT touch that file. Never add a
   second header to a file that already has one.

4. **Insert the header at the very top of the file.** For files missing a
   header, insert these exact two lines as the first two lines of the file,
   above ALL existing content (including shebangs, comments, or blank
   lines):

   ```
   // SPDX-License-Identifier: Apache-2.0
   // Copyright (c) 2026 Acme Corp
   ```

   The header MUST be the very first thing in the file. Never insert it
   after existing content.

5. **Report results.** List which files were changed and which were skipped
   (already had a header).
