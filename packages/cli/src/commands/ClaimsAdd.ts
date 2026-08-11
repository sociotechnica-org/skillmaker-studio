/**
 * `skillmaker claims add <slug> --id <id> --failure <text> [--must-never
 * <text>] [--probability <p>] [--impact <i>]` — the CLI door for the design
 * layer (write-side tranche item 6): appends one failure hypothesis (a
 * claim) to a skill.json bundle's `design.failureHypotheses`, born with an
 * empty `cases: []` pointer array (`fixture add --risks` wires the edges as
 * cases realize it). This is the eval-writer skill's future write path —
 * design-skill's SKILL.md moves from authoring root `evals.json` to this
 * door in a follow-up.
 *
 * skill.json bundles only: on a legacy bundle the command refuses (the
 * write side follows migration; legacy claims keep living in root
 * evals.json until the bundle migrates). Claims are files, not journal
 * events — nothing is appended to the journal here.
 */
import {
  addClaimToSkillJson,
  bundleMarkerExists,
  isKnownRiskFamily,
  riskFamily,
  SKILL_JSON_FILENAME,
  Workspace,
} from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface ClaimsAddOptions {
  readonly json: boolean;
  readonly id?: string;
  readonly failure?: string;
  readonly mustNever?: string;
  readonly probability?: string;
  readonly impact?: string;
}

const USAGE =
  'Usage: skillmaker claims add <slug> --id <id> --failure <text> [--must-never <text>] [--probability <p>] [--impact <i>]\n';

export const runClaimsAdd = Effect.fn("runClaimsAdd")(function* (
  cwd: string,
  slug: string | undefined,
  options: ClaimsAddOptions,
) {
  if (slug === undefined) {
    return usageError(`skillmaker claims add: missing <slug>\n\n${USAGE}`);
  }
  const id = options.id?.trim();
  if (id === undefined || id.length === 0) {
    return usageError(`skillmaker claims add: missing --id <id>\n\n${USAGE}`);
  }
  if (!isKnownRiskFamily(riskFamily(id))) {
    return usageError(
      `skillmaker claims add: claim id "${id}" does not band into a known family (expected IN|RE|OUT|ADV|CHN prefix)\n`,
    );
  }
  const failure = options.failure?.trim();
  if (failure === undefined || failure.length === 0) {
    return usageError(`skillmaker claims add: missing --failure <text>\n\n${USAGE}`);
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));
  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker claims add: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* bundleMarkerExists(bundleDir);
  if (!bundleExists) {
    return expectedFailure(`skillmaker claims add: no such bundle "${slug}"\n`);
  }

  const hasSkillJson = yield* fs.exists(path.join(bundleDir, SKILL_JSON_FILENAME));
  if (!hasSkillJson) {
    return expectedFailure(
      `skillmaker claims add: "${slug}" is a legacy (bundle.json) bundle -- claims add writes skill.json's design.failureHypotheses; migrate the bundle first (scripts/migrate-skill-json.ts)\n`,
    );
  }

  const outcome = yield* addClaimToSkillJson(bundleDir, {
    id,
    failure,
    ...(options.mustNever !== undefined ? { mustNever: options.mustNever } : {}),
    ...(options.probability !== undefined ? { probability: options.probability } : {}),
    ...(options.impact !== undefined ? { impact: options.impact } : {}),
  });

  switch (outcome.kind) {
    case "exists":
      return expectedFailure(
        `skillmaker claims add: claim "${id}" already exists in ${slug}/skill.json\n`,
      );
    case "unusable":
      return expectedFailure(
        `skillmaker claims add: ${slug}/skill.json is not a usable JSON object; fix it before adding claims\n`,
      );
    case "added":
      return summarize(slug, id, failure, options.json);
  }
});

const summarize = (slug: string, id: string, failure: string, json: boolean): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status: "added", bundle: slug, id, failure })}\n`);
  }
  return ok(`skillmaker: added claim ${id} to ${slug}/skill.json\n`);
};
