/**
 * `skillmaker fixture add <slug> <case> [--class ...] [--risks IN-1,RE-2]`
 * (alias: `skillmaker case add`, the ruled vocabulary) — scaffolds one eval
 * case for an existing bundle, generation-aware through the ONE core door
 * (`@skillmaker/core`'s `scaffoldCaseForBundle`, which `fixture harvest`
 * writes through too):
 *
 * - On a skill.json bundle (THE MERGE write side): appends the case entry
 *   to `skill.json`'s `evals.cases` and scaffolds `evals/cases/<case>/`
 *   (prompt.md, files/, expected.md). `--risks` ids MUST exist in
 *   `design.failureHypotheses` — a dangling id is a clean refusal — and
 *   each named claim gains the hypothesis→case pointer (the model's only
 *   edge). Realizing a case skill.json already lists (a planned proof
 *   spec) is the designed order, not a collision.
 * - On a legacy bundle: exactly today's behavior — `evals/fixtures/<case>/`
 *   with `case.json` (risks unvalidated, as before). The write side
 *   follows migration, never forces it.
 *
 * Fixtures are files, not journal events — nothing is appended to the
 * journal here (plan.md Phase 7).
 */
import {
  FIXTURE_CLASSES,
  isFixtureClass,
  isKnownRiskFamily,
  riskFamily,
  scaffoldCaseForBundle,
  Workspace,
  type FixtureClass,
  bundleMarkerExists,
} from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface FixtureAddOptions {
  readonly json: boolean;
  readonly klass?: string;
  readonly risks?: string;
  /** How the command was invoked (`fixture add` or its `case add` alias) — used verbatim in messages. */
  readonly commandLabel?: string;
}

export const runFixtureAdd = Effect.fn("runFixtureAdd")(function* (
  cwd: string,
  slug: string | undefined,
  caseName: string | undefined,
  options: FixtureAddOptions,
) {
  const label = options.commandLabel ?? "fixture add";
  if (slug === undefined || caseName === undefined) {
    return usageError(
      `skillmaker ${label}: missing <slug> <case>\n\nUsage: skillmaker ${label} <slug> <case> [--class ${FIXTURE_CLASSES.join("|")}] [--risks IN-1,RE-2]\n`,
    );
  }

  const klass = options.klass ?? "golden";
  if (!isFixtureClass(klass)) {
    return usageError(
      `skillmaker ${label}: invalid --class "${klass}" (expected ${FIXTURE_CLASSES.join("|")})\n`,
    );
  }

  const risks =
    options.risks === undefined || options.risks.trim().length === 0
      ? []
      : options.risks.split(",").map((risk) => risk.trim()).filter((risk) => risk.length > 0);
  for (const riskId of risks) {
    const family = riskFamily(riskId);
    if (!isKnownRiskFamily(family)) {
      return usageError(
        `skillmaker ${label}: risk id "${riskId}" does not band into a known family (expected IN|RE|OUT|ADV|CHN prefix)\n`,
      );
    }
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      `skillmaker ${label}: no skillmaker workspace found (run \`skillmaker init\` first)\n`,
    );
  }

  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* bundleMarkerExists(bundleDir);
  if (!bundleExists) {
    return expectedFailure(`skillmaker ${label}: no such bundle "${slug}"\n`);
  }

  const outcome = yield* scaffoldCaseForBundle(bundleDir, { caseName, klass, risks });

  switch (outcome.kind) {
    case "case-dir-exists":
      return expectedFailure(
        `skillmaker ${label}: ${outcome.caseDirRel}/ already exists for "${slug}"\n`,
      );
    case "dangling-risks":
      return expectedFailure(
        `skillmaker ${label}: unknown claim id(s) ${outcome.missing.join(", ")} -- ids must exist in skill.json's design.failureHypotheses (add the claim first: skillmaker claims add ${slug} --id ${outcome.missing[0]} --failure "...")\n`,
      );
    case "unusable-skill-json":
      return expectedFailure(
        `skillmaker ${label}: ${slug}/skill.json is not a usable JSON object; fix it before adding cases\n`,
      );
    case "created":
    case "realized":
      return summarize(label, slug, caseName, klass, risks, outcome.kind, outcome.caseDirRel, options.json);
  }
});

const summarize = (
  label: string,
  slug: string,
  caseName: string,
  klass: FixtureClass,
  risks: ReadonlyArray<string>,
  kind: "created" | "realized",
  caseDirRel: string,
  json: boolean,
): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({ status: kind, bundle: slug, case: caseName, class: klass, risks, caseDir: caseDirRel })}\n`,
    );
  }
  // Legacy bundles keep the pre-merge wording exactly ("created fixture").
  const noun = caseDirRel.includes("fixtures") ? "fixture" : "case";
  const verb = kind === "realized" ? `realized planned ${noun}` : `created ${noun}`;
  return ok(`skillmaker: ${verb} ${slug}/${caseDirRel}/ (class: ${klass})\n`);
};
