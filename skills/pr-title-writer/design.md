---
bundle: pr-title-writer
---
# Design — PR Title Writer

## Intent
Given a diff and its commit messages, produce a single PR title that a
reviewer can scan in a list of 40 PRs and know what changed and why. The
audience is a busy maintainer triaging, not the author.

## When to use / triggers
- The user is opening a pull request and asks for a title, or
- The user pastes a diff / commit range and asks "what should I call this PR".
Not for: commit messages (different granularity), changelog entries (different
audience — see changelog-entry-writer).

## The workflow
1. Read the full diff and the commit subject lines.
2. Identify the *single* dominant change. If there are several unrelated
   changes, say so and suggest splitting the PR rather than inventing an
   umbrella title.
3. Draft one line, <= 70 chars, imperative mood, no trailing period.
4. Prefix with a conventional-commit type (feat/fix/refactor/docs/chore) only
   if the repo's existing PR titles use them; otherwise match local style.
5. Never invent a ticket number, scope, or behavior not present in the diff.

## Failure hypotheses
| # | How it could fail | Risk family |
|---|---|---|
| 1 | Summarizes only the largest file, missing the actual point | RE |
| 2 | Umbrella title hides that the PR does two unrelated things | OUT |
| 3 | Invents a JIRA ticket / scope not in the diff | OUT |
| 4 | Fires on a plain commit-message request (wrong trigger) | IN |

## Proof spec
- golden: a focused single-purpose diff → one crisp title.
- hard-case: a two-purpose diff → refuses an umbrella, suggests a split.
- refusal: asked for a title with no diff/context → asks for the diff.
- trigger: does it activate on "help me name this PR" but not "write my commit"?
