# Research Notes — Changelog Entry Writer

## Topic restatement

This skill takes a git diff (and possibly recent commit messages) representing a
completed change, and produces a well-formed entry to insert into the repo's
`CHANGELOG.md` under its "Unreleased" heading. The entry must match whichever
changelog format the repo already uses, use the correct category, and be written
in human-friendly prose — not a raw commit dump.

---

## Facts and conventions the skill must get right

### 1. The Keep a Changelog format (dominant convention)

Source: [keepachangelog.com v1.1.0](https://keepachangelog.com/en/1.1.0/)

| Element | Exact format |
|---------|-------------|
| File title | `# Changelog` (h1, first line) |
| Version heading | `## [X.Y.Z] - YYYY-MM-DD` (h2, version in square brackets, ISO 8601 date) |
| Unreleased heading | `## [Unreleased]` (h2, no date) |
| Category headings | `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed`, `### Security` (h3) |
| Entry format | Markdown list item (`- `) under the appropriate category |
| Ordering | Latest version first; Unreleased always at the top |
| Link references (bottom of file) | `[unreleased]: https://github.com/user/repo/compare/vX.Y.Z...HEAD` and `[X.Y.Z]: https://github.com/user/repo/compare/vA.B.C...vX.Y.Z` |

The six categories in standard order:
1. Added — new features
2. Changed — changes in existing functionality
3. Deprecated — soon-to-be removed features
4. Removed — now removed features
5. Fixed — bug fixes
6. Security — vulnerability patches

### 2. Common Changelog (stricter variant)

Source: [common-changelog.org](https://common-changelog.org/)

Differences from Keep a Changelog:
- Only four categories, in strict order: Changed, Added, Removed, Fixed.
- No Deprecated or Security categories.
- No `[Unreleased]` section at all (entries are written at release time).
- Requires references (PR/commit links) on every entry line.
- Requires author attribution in parentheses.
- Breaking changes prefixed with `**Breaking:**`.
- Version heading format: `## [X.Y.Z] - YYYY-MM-DD` (same bracket+date format).

### 3. Verb tense / mood

Source: [Keep a Changelog issue #54](https://github.com/olivierlacan/keep-a-changelog/issues/54), Common Changelog spec

- **Imperative mood, present tense** is the dominant convention: "Add", "Fix",
  "Remove", "Bump" — not "Added" or "Fixes".
- Keep a Changelog's own examples use past participle style ("Added", "Changed")
  as category names but many repos use imperative in the entry text itself.
- The skill should **match whatever tense the existing entries use** rather than
  imposing one. If the file has no prior entries, default to imperative.

### 4. Semantic versioning implications

Source: [semver.org](https://semver.org/)

The skill does NOT assign a version number (that's a release concern), but it
should place entries under the correct *category* which later informs the bump:

| Category | Typical SemVer signal |
|----------|----------------------|
| Added | MINOR |
| Changed (breaking) | MAJOR |
| Changed (non-breaking) | MINOR or PATCH |
| Deprecated | MINOR |
| Removed | MAJOR |
| Fixed | PATCH |
| Security | PATCH |

### 5. Conventional Commits mapping

Source: [conventionalcommits.org](https://www.conventionalcommits.org/en/v1.0.0-beta.2/)

If commit messages follow Conventional Commits, the type maps to a category:

| Commit type | Changelog category |
|------------|-------------------|
| `feat` | Added |
| `fix` | Fixed |
| `BREAKING CHANGE` / `!` | Changed (with breaking note) or Removed |
| `docs`, `chore`, `ci`, `test`, `style` | Usually omitted from changelog |
| `refactor`, `perf` | Changed |
| `deprecate` (non-standard but used) | Deprecated |

### 6. Where to insert the entry

The entry goes:
- Under the `## [Unreleased]` heading.
- Under the appropriate `### Category` sub-heading within that section.
- If the category sub-heading doesn't exist yet under Unreleased, create it.
- If `## [Unreleased]` doesn't exist, create it immediately after the `# Changelog` title (or after whatever h1 the file starts with).
- Entries are appended at the end of the category's list (not prepended),
  matching Keep a Changelog's own changelog.

### 7. Entry content guidelines

- Summarize the *user-visible effect*, not the implementation detail.
- One bullet per logical change; a PR that does multiple things may need
  multiple bullets (possibly in different categories).
- Keep it to one or two sentences — enough to decide whether to read the diff.
- Include a PR/issue reference if the repo's style does so (e.g., `(#123)`).

---

## Edge cases and gotchas

### The skill must handle:

1. **No existing CHANGELOG.md** — must create the file from scratch with correct
   structure (`# Changelog\n\n## [Unreleased]\n\n### Added\n\n- ...`).

2. **Existing file uses a non-standard format** — the skill must detect the
   prevailing style (heading levels, category names, tense, whether references
   are used) and conform to it, rather than blindly emitting Keep a Changelog
   format into a file that uses something else.

3. **No `## [Unreleased]` section exists** — must create it in the correct
   position (after the h1 title, before the first versioned section).

4. **Category sub-heading missing under Unreleased** — must create it in the
   standard order relative to other existing categories.

5. **Multiple changes in one diff** — the diff may contain several logically
   distinct changes (e.g., a new feature AND a bug fix). The skill should
   produce multiple entries under different categories if warranted.

6. **Diff is trivial / changelog-unworthy** — changes like whitespace cleanup,
   CI config tweaks, or internal refactors that have no user-visible effect.
   The skill should either skip these or note that no entry is needed, rather
   than fabricating something.

7. **Breaking changes** — must be clearly flagged. In Keep a Changelog this goes
   under Changed or Removed. In Common Changelog it gets a `**Breaking:**`
   prefix.

8. **File with CRLF line endings or trailing newline conventions** — must
   preserve the file's existing line-ending style.

9. **Duplicate entries** — if the Unreleased section already contains an entry
   that covers the same change (e.g., skill was run twice), the skill must not
   add a duplicate.

### The skill must never:

1. **Modify or rewrite existing versioned entries** — only the Unreleased
   section is fair game.

2. **Assign a version number or date to the Unreleased section** — that's a
   release step, not an entry-writing step.

3. **Dump raw commit messages verbatim** — the whole point is human-friendly
   prose. "Fix: resolve edge case in parser" is fine; `fix(parser): handle
   edge case where null input caused crash in tokenizer.ts:42` is not.

4. **Invent changes not present in the diff** — the entry must be grounded in
   what actually changed, not what the skill *thinks* might have changed.

5. **Remove or reorder existing Unreleased entries** — other contributors may
   have added entries; the skill appends, it doesn't curate.

6. **Break the link references at the bottom of the file** — if the file has
   `[unreleased]: ...` comparison links, they must be preserved and remain
   valid.

7. **Add empty category headings** — if a category has no entries, don't create
   a heading for it.

---

## Open questions

1. **How should the skill determine the "existing style" of a non-standard
   changelog?** Heuristics could include: checking h2/h3 heading text, detecting
   whether entries use imperative or past tense, checking for PR links. But how
   many entries must be sampled, and what happens when the file is inconsistent
   with itself? This needs a design decision.

2. **Should the skill support changelogs that DON'T use an Unreleased section
   (e.g., Common Changelog)?** Common Changelog argues against Unreleased
   sections. If the file has no Unreleased heading and the most recent section
   is a versioned release, should the skill create an Unreleased section anyway,
   or append to the latest version, or refuse?

3. **What is the input interface?** The bundle says "from the git diff and
   commit messages" but the exact mechanism matters: does the skill run
   `git diff HEAD~1` itself, or receive the diff as context? Does it look at
   staged changes, or the last N commits since some tag? The design must specify
   the boundary.

4. **Should the skill handle multi-package monorepos?** Some monorepos maintain
   per-package changelogs (e.g., `packages/foo/CHANGELOG.md`). Should the skill
   detect this and route entries to the correct file, or is that out of scope?

5. **How should the skill handle repos that use fragment-based changelogs
   (towncrier, GitLab's YAML approach, scriv)?** These repos don't want entries
   in `CHANGELOG.md` directly — they want a fragment file. Should the skill
   detect this and produce a fragment instead, or only target monolithic
   `CHANGELOG.md` files?
