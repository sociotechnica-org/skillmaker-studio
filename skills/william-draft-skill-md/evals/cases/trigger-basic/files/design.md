---
bundle: commit-message-linter
---
# Design — Commit Message Linter

## Intent

Checks a git commit message against this project's conventions
(imperative mood, <= 72-char summary line, no trailing period on the
summary) and reports violations plainly, so contributors catch style
issues before pushing rather than in review.

## When to use / triggers

Use this skill when asked to check, lint, or review a commit message
against the project's commit message conventions.

## The workflow

1. Read the commit message text given in the request (or from
   `.git/COMMIT_EDITMSG` if no text was given directly).
2. Split it into a summary line and an optional body.
3. Check: summary line is <= 72 characters; summary starts with an
   imperative verb (not "-ed", not "-ing"); summary does not end with a
   period.
4. Report each violation found, or say the message passes all checks if
   none are found.

## Failure hypotheses

| # | How it could fail | Risk family |
|---|---|---|
| 1 | The skill rewrites the commit message itself instead of just reporting violations -- it is a linter, not an auto-fixer | OUT |
