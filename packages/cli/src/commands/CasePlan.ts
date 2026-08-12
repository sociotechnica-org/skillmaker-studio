/**
 * `skillmaker case plan <slug> --name <case> --class <class> [--setup
 * <prose>] [--expected-behavior <prose>] [--risks IN-1,RE-2]` — the design
 * conversation's case door: appends one PLANNED case to a skill.json
 * bundle's `evals.cases[]` — prose `setup`/`expectedBehavior`, NO
 * `evals/cases/<name>/` materials directory (planned = the old proof spec;
 * `case add` later realizes it by scaffolding materials) — and wires the
 * hypothesis→case pointer on every claim named in `--risks` (each id must
 * already exist in `design.failureHypotheses`; a dangling id is a clean
 * refusal, same as `case add`).
 *
 * skill.json bundles only: on a legacy bundle the command refuses (the
 * write side follows migration; legacy proof specs keep living in root
 * evals.json until the bundle migrates — same convention as `claims add`).
 * Re-planning an already-listed name is idempotent: the entry is kept
 * untouched and only missing pointers are added. Cases are files, not
 * journal events — nothing is appended to the journal here.
 */
import {
  addCaseToSkillJson,
  bundleMarkerExists,
  FIXTURE_CLASSES,
  isFixtureClass,
  isKnownRiskFamily,
  riskFamily,
  SKILL_JSON_FILENAME,
  Workspace,
  type FixtureClass,
} from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface CasePlanOptions {
  readonly json: boolean;
  readonly name?: string;
  readonly klass?: string;
  readonly setup?: string;
  readonly expectedBehavior?: string;
  readonly risks?: string;
  /** How the command was invoked (`case plan` or its `fixture plan` alias) — used verbatim in messages. */
  readonly commandLabel?: string;
}

const usage = (label: string): string =>
  `Usage: skillmaker ${label} <slug> --name <case> [--class ${FIXTURE_CLASSES.join("|")}] [--setup <prose>] [--expected-behavior <prose>] [--risks IN-1,RE-2]\n`;

export const runCasePlan = Effect.fn("runCasePlan")(function* (
  cwd: string,
  slug: string | undefined,
  options: CasePlanOptions,
) {
  const label = options.commandLabel ?? "case plan";
  if (slug === undefined) {
    return usageError(`skillmaker ${label}: missing <slug>\n\n${usage(label)}`);
  }
  const caseName = options.name?.trim();
  if (caseName === undefined || caseName.length === 0) {
    return usageError(`skillmaker ${label}: missing --name <case>\n\n${usage(label)}`);
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
    if (!isKnownRiskFamily(riskFamily(riskId))) {
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

  const fs = yield* FileSystem;
  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* bundleMarkerExists(bundleDir);
  if (!bundleExists) {
    return expectedFailure(`skillmaker ${label}: no such bundle "${slug}"\n`);
  }

  const hasSkillJson = yield* fs.exists(path.join(bundleDir, SKILL_JSON_FILENAME));
  if (!hasSkillJson) {
    return expectedFailure(
      `skillmaker ${label}: "${slug}" is a legacy (bundle.json) bundle -- case plan writes skill.json's evals.cases; migrate the bundle first (scripts/migrate-skill-json.ts)\n`,
    );
  }

  const outcome = yield* addCaseToSkillJson(bundleDir, {
    caseName,
    klass,
    risks,
    ...(options.setup !== undefined ? { setup: options.setup } : {}),
    ...(options.expectedBehavior !== undefined ? { expectedBehavior: options.expectedBehavior } : {}),
  });

  switch (outcome.kind) {
    case "dangling-risks":
      return expectedFailure(
        `skillmaker ${label}: unknown claim id(s) ${outcome.missing.join(", ")} -- ids must exist in skill.json's design.failureHypotheses (add the claim first: skillmaker claims add ${slug} --id ${outcome.missing[0]} --failure "...")\n`,
      );
    case "unusable":
      return expectedFailure(
        `skillmaker ${label}: ${slug}/skill.json is not a usable JSON object; fix it before planning cases\n`,
      );
    case "added":
    case "realized":
      return summarize(label, slug, caseName, klass, risks, outcome.kind, options.json);
  }
});

const summarize = (
  label: string,
  slug: string,
  caseName: string,
  klass: FixtureClass,
  risks: ReadonlyArray<string>,
  kind: "added" | "realized",
  json: boolean,
): CliResult => {
  const status = kind === "added" ? "planned" : "already-listed";
  if (json) {
    return ok(
      `${JSON.stringify({ status, bundle: slug, case: caseName, class: klass, risks })}\n`,
    );
  }
  if (kind === "realized") {
    // Idempotent re-plan: entry kept as-is; only missing pointers were added.
    return ok(
      `skillmaker: case "${caseName}" already listed in ${slug}/skill.json (entry kept; hypothesis pointers updated)\n`,
    );
  }
  return ok(
    `skillmaker: planned case "${caseName}" in ${slug}/skill.json (class: ${klass}; realize it with \`skillmaker case add ${slug} ${caseName}\`)\n`,
  );
};
