---
name: bulk-file-renamer
description: >
  Rename multiple files in a directory according to a user-supplied pattern or
  rule (e.g. change extensions, add prefixes, apply sequential numbering).
---

# Bulk File Renamer

> **UNRESOLVED DESIGN CONFLICT — read before proceeding.**
>
> `design.md` contradicts itself on whether confirmation is required:
>
> - **Intent** states: "this skill must always ask the user to confirm the
>   exact list of proposed renames before touching any file on disk."
> - **The workflow** step 3 states: "Rename each file immediately… Do not
>   pause for confirmation."
> - **Failure hypotheses** row 1 identifies skipping confirmation as a known
>   adverse failure mode.
>
> Until the design owner resolves this conflict, **default to the safer
> behavior: always confirm before renaming.** This aligns with Intent and
> the Failure hypotheses table. Do NOT silently skip confirmation.

## Procedure

1. Identify the target directory and the rename rule from the user's request.
2. Scan the target directory for files matching the rule's source pattern.
3. For each matching file, compute the proposed new name.
4. **Present the full list of proposed renames to the user and wait for
   explicit confirmation before touching any file.** (See conflict note
   above — this step follows the Intent section's requirement.)
5. After confirmation, rename each file.
   - If a proposed new name collides with an existing file, stop and report
     the collision rather than silently overwriting.
6. Report the final list of renames performed (old name -> new name).

## Constraints

- **Never rename without confirmation.** Failure hypothesis #1 (ADV)
  specifically flags unconfirmed renames as a known failure path — a naming
  collision can silently destroy data.
- If the computed rename list is empty (no files match), tell the user and
  stop. Do not prompt for a different pattern unprompted.
