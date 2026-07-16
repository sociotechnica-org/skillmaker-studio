# Research Notes — PR Title Writer

## Topic restatement

This skill takes a diff (with its commit messages) and produces a single
pull-request title — one line a busy maintainer can scan in a list of 40 PRs
and immediately know *what changed* and *why*. The audience is the reviewer
triaging, not the author. The skill must also detect when a PR contains
unrelated changes and recommend splitting instead of papering over the problem
with a vague umbrella title.

---

## Facts and conventions the skill must get right

### Character length

- **GitHub's hard limit on issue/PR titles is 256 characters** (verified via
  the `dead-claudia/github-limits` repo — issue titles min 1, max 256; PR
  titles are stored the same way).
- **Practical display limit is ~70 characters.** GitHub's web UI truncates
  commit subject lines at 72 chars with "…". When creating a PR from a single
  commit, GitHub auto-splits at ~70 chars — anything beyond goes into the
  description. The `refined-github` extension warns at this threshold too.
- **The design says <= 70 chars.** This is the right target. It keeps the
  title fully visible in the PR list, in `git log --oneline`, and in
  squash-merge commit subjects.
- **When conventional-commit prefixes are used, the prefix + colon + space
  eat into the 70-char budget.** E.g., `refactor(auth): ` is 17 chars,
  leaving only 53 for the description. The skill should count the full line,
  not just the description portion.

### Imperative mood

- Git's own documentation and the Conventional Commits spec both require
  imperative mood: "Add", "Fix", "Remove" — not "Added", "Fixes", "Removing".
- The test: the title should complete the sentence *"If applied, this PR
  will ___."*
- Common imperative verbs in PR titles: Add, Fix, Remove, Update, Refactor,
  Replace, Extract, Move, Rename, Drop, Deprecate, Revert, Implement,
  Simplify, Optimize, Handle, Support, Migrate, Upgrade, Downgrade, Pin.
- **No trailing period.** This is a subject line, not a sentence.

### Conventional-commit prefixes

The Conventional Commits 1.0.0 spec defines two required types:

| Type | Meaning |
|------|---------|
| `feat` | A new feature (correlates with MINOR in semver) |
| `fix` | A bug fix (correlates with PATCH in semver) |

And commonly-used optional types:

| Type | Meaning |
|------|---------|
| `refactor` | Code restructuring, no behavior change |
| `docs` | Documentation only |
| `chore` | Maintenance (deps, config, tooling) |
| `test` | Adding or correcting tests |
| `perf` | Performance improvement, no feature change |
| `build` | Build system or external dependencies |
| `ci` | CI configuration |
| `style` | Formatting, whitespace, semicolons — no logic change |
| `revert` | Reverting a previous commit |

Format: `<type>(<optional scope>): <description>`

- The scope is optional and repo-specific. It is **never** invented by the
  skill — it must appear in the diff or in the repo's existing PR history.
- The colon-space after the type (or scope) is mandatory in the spec.
- **Critical rule from the design: only use conventional-commit prefixes if
  the repo's existing PR titles already use them.** The skill must inspect
  the repo's PR history or stated conventions, not assume.

### Squash-and-merge implications

- Many teams configure GitHub to use the PR title as the squash-merge commit
  subject. GitHub appends the PR number automatically, e.g.,
  `feat: add search to dashboard (#42)`.
- This means the PR title effectively *becomes* a permanent commit message.
  Getting it right matters more than on repos that use merge commits.
- The skill does not need to add the `(#NNN)` suffix — GitHub does this
  automatically at merge time.

---

## Edge cases and gotchas

### The skill must handle:

1. **Multi-purpose PRs.** If the diff contains unrelated changes (e.g., a bug
   fix and a new feature), the skill must refuse to write a single title and
   instead recommend splitting. The heuristic: if you need "and" in the title,
   or two different conventional-commit types would apply, it is likely two
   PRs.

2. **Large diffs where the biggest file is not the point.** A PR might touch
   a 500-line generated migration file but the actual change is a 3-line
   model tweak. The skill must look at the commit messages and the
   human-authored code, not just line-count.

3. **Rename / move-only PRs.** `git diff` for a rename can be huge but the
   semantic change is trivial. The skill should recognize rename patterns
   (similarity index in diff headers) and title accordingly, e.g.,
   "Move auth middleware to shared package".

4. **Revert PRs.** The title should say what is being reverted, not just
   "Revert X". Best form: `revert: <original title>` or
   `Revert "<original title>"` depending on repo convention.

5. **Dependency-only PRs (Dependabot / Renovate).** These already come with
   machine-generated titles. The skill should recognize when it is looking at
   an automated dependency bump and either pass through the existing title or
   lightly clean it up, not rewrite it into something less informative.

6. **Diffs with no commit messages** (e.g., user pastes a raw diff). The
   skill must derive the title purely from the code changes. This is harder
   but explicitly in scope per the design's trigger list.

7. **Repos with non-conventional-commit title styles.** Some repos use
   `[component] Description`, `JIRA-123: Description`, or free-form.
   The skill must match whatever local convention exists, not force
   conventional commits onto a repo that doesn't use them.

### The skill must never:

1. **Invent a ticket number** (e.g., JIRA-123, PROJ-456) not present in the
   diff or commit messages. This is explicit in the design.

2. **Invent a scope** not present in the diff. If the diff touches
   `src/auth/login.ts`, the skill may *suggest* `(auth)` as a scope only if
   the repo already uses scoped conventional commits. It must not guess
   scopes for repos that don't use them.

3. **Add a trailing period.** Subject lines don't end with periods in any
   mainstream convention.

4. **Use past tense or gerund.** "Fixed the bug" and "Fixing the bug" are
   both wrong. "Fix the bug" is correct (though typically without "the" —
   "Fix login redirect loop").

5. **Exceed 70 characters** (per the design's explicit constraint). If the
   natural title is longer, the skill must shorten it, not just emit a
   warning.

6. **Fire on commit-message requests.** The design explicitly excludes
   commit-message writing — that is a different granularity. The skill
   should only activate when the user is clearly asking about a PR title.

7. **Add GitHub keywords** like `closes #123` or `fixes #456` into the
   title. These belong in the PR body or commit message, not the title.

---

## Open questions

1. **How should the skill detect the repo's existing title convention?**
   The design says "prefix with conventional-commit type only if the repo's
   existing PR titles use them." But when invoked, the skill may not have
   access to the repo's PR history — it might only have the diff and commit
   messages. Should the skill ask the user about their convention, infer from
   commit message style, or default to no prefix? This needs a design
   decision.

2. **What counts as "unrelated changes" worthy of a split recommendation?**
   Two files in different packages? Two different conventional-commit types?
   A refactor mixed with a feature? The heuristic needs to be concrete enough
   to implement consistently. A diff that refactors *in service of* a feature
   is one PR; a diff that refactors something unrelated while also adding a
   feature is two.

3. **Should the skill offer alternatives?** The design says "draft one line."
   But in practice, there are often 2-3 reasonable phrasings. Should the
   skill output exactly one title, or a ranked short-list (e.g., top pick +
   1 alternative)? Outputting one is simpler and more opinionated; outputting
   a few gives the user choice but may feel indecisive.

4. **How should the skill handle PRs that are purely test additions?**
   A PR that only adds tests is legitimate, but the title "Add tests for
   auth module" is less informative than "Test login redirect edge cases."
   Should the skill prefer the specific behavior being tested, or the
   structural description? (Probably the former, but this is a style call.)

5. **What about breaking-change indicators?** Conventional Commits uses `!`
   after the type/scope (e.g., `feat!: remove legacy API`) to signal a
   breaking change. Should the skill detect breaking changes in the diff
   (removed public API, changed function signatures) and add the `!`? This
   is high-value but also high-risk for false positives.
