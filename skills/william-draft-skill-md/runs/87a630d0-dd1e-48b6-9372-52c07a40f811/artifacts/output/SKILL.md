---
name: add-license-header
description: Add the project's canonical SPDX license header to a requested source file or to source files under a requested directory. Use when asked to add or ensure license headers on files that may not already have one.
---

# Add License Header

1. Determine the target files from the request:
   - For a file path, target that file.
   - For a directory, target every file beneath it whose extension matches the project's source extensions.
2. Read the first 20 lines of every target file and look for `SPDX-License-Identifier`.
3. If that string is present, skip the file. Never add a second SPDX license header.
4. Otherwise, insert these exact lines at the very top of the file, before all existing content:

   ```text
   // SPDX-License-Identifier: Apache-2.0
   // Copyright (c) 2026 Acme Corp
   ```

   Always put the header at the absolute beginning; never place it after a shebang, comment, or any other existing content.
5. Report the files changed and the files skipped because they already had a header.
