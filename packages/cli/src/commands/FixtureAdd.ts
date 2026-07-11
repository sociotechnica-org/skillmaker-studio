/**
 * `skillmaker fixture add <slug> <case> [--class ...] [--risks IN-1,RE-2]` —
 * scaffolds `evals/fixtures/<case>/` for an existing bundle: `case.json`,
 * `prompt.md` (the PROMPT.MD CHANGE — the task prompt lives here, not in
 * `case.json`, data-model.md §2.5), `files/.gitkeep`, and
 * `expected/answer-key.md` skeleton. Fixtures are files, not journal events
 * — nothing is appended to the journal here (plan.md Phase 7).
 */
import { FIXTURE_CLASSES, type FixtureClass, isKnownRiskFamily, riskFamily, Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface FixtureAddOptions {
  readonly json: boolean;
  readonly klass?: string;
  readonly risks?: string;
}

const isFixtureClass = (value: string): value is FixtureClass =>
  (FIXTURE_CLASSES as ReadonlyArray<string>).includes(value);

const promptSkeleton = (caseName: string): string =>
  `<!-- The eval task prompt for "${caseName}" (prose, sent to the agent as-is). -->
`;

const answerKeySkeleton = (caseName: string): string =>
  `# Answer key — ${caseName}

<!-- Grading-only: never enters the agent's workspace [inherited]. -->
`;

export const runFixtureAdd = Effect.fn("runFixtureAdd")(function* (
  cwd: string,
  slug: string | undefined,
  caseName: string | undefined,
  options: FixtureAddOptions,
) {
  if (slug === undefined || caseName === undefined) {
    return usageError(
      "skillmaker fixture add: missing <slug> <case>\n\nUsage: skillmaker fixture add <slug> <case> [--class golden|refusal|empty|rerun|hard-case] [--risks IN-1,RE-2]\n",
    );
  }

  const klass = options.klass ?? "golden";
  if (!isFixtureClass(klass)) {
    return usageError(
      `skillmaker fixture add: invalid --class "${klass}" (expected ${FIXTURE_CLASSES.join("|")})\n`,
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
        `skillmaker fixture add: risk id "${riskId}" does not band into a known family (expected IN|RE|OUT|ADV|CHN prefix)\n`,
      );
    }
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker fixture add: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* fs.exists(path.join(bundleDir, "bundle.json"));
  if (!bundleExists) {
    return expectedFailure(`skillmaker fixture add: no such bundle "${slug}"\n`);
  }

  const caseDir = path.join(bundleDir, "evals", "fixtures", caseName);
  const caseDirExists = yield* fs.exists(caseDir);
  if (caseDirExists) {
    return expectedFailure(
      `skillmaker fixture add: evals/fixtures/${caseName}/ already exists for "${slug}"\n`,
    );
  }

  yield* fs.makeDirectory(path.join(caseDir, "files"), { recursive: true });
  yield* fs.makeDirectory(path.join(caseDir, "expected"), { recursive: true });

  yield* fs.writeFileString(
    path.join(caseDir, "case.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        case: caseName,
        class: klass,
        risks,
      },
      null,
      2,
    )}\n`,
  );
  yield* fs.writeFileString(path.join(caseDir, "prompt.md"), promptSkeleton(caseName));
  yield* fs.writeFileString(path.join(caseDir, "files", ".gitkeep"), "");
  yield* fs.writeFileString(path.join(caseDir, "expected", "answer-key.md"), answerKeySkeleton(caseName));

  return summarize(slug, caseName, klass, risks, options.json);
});

const summarize = (
  slug: string,
  caseName: string,
  klass: FixtureClass,
  risks: ReadonlyArray<string>,
  json: boolean,
): CliResult => {
  if (json) {
    return ok(`${JSON.stringify({ status: "created", bundle: slug, case: caseName, class: klass, risks })}\n`);
  }
  return ok(`skillmaker: created fixture ${slug}/evals/fixtures/${caseName}/ (class: ${klass})\n`);
};
