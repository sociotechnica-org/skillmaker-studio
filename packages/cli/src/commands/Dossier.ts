/**
 * `skillmaker dossier <slug>` — prints one bundle's `dossier.md` (issue #94):
 * Job, Contexts, Out-of-scope, Basis, Evidence, Fit criterion, each shown as
 * recorded content or an honest gap ("fit criterion: unrecorded") -- never a
 * failure, mirroring `status`'s read-only, index-free shape (this command
 * needs no SQLite rebuild -- `dossier.md` is read directly, the same way
 * `Server.ts`'s bundle-detail handler reads it for the viewer).
 */
import { parseDossier, Workspace } from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { type CliResult, expectedFailure, ok, usageError } from "../CliResult.ts";

export interface DossierOptions {
  readonly json: boolean;
}

export const runDossier = Effect.fn("runDossier")(function* (
  cwd: string,
  slug: string | undefined,
  options: DossierOptions,
) {
  if (slug === undefined) {
    return usageError("skillmaker dossier: missing <slug>\n\nUsage: skillmaker dossier <slug>\n");
  }

  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure("skillmaker dossier: no skillmaker workspace found (run `skillmaker init` first)\n");
  }

  const fs = yield* FileSystem;
  const path = yield* Path;
  const bundleDir = path.join(resolved.root, resolved.config.skillsDir, slug);

  const bundleExists = yield* fs.exists(path.join(bundleDir, "bundle.json"));
  if (!bundleExists) {
    return expectedFailure(`skillmaker dossier: no such bundle "${slug}"\n`);
  }

  const { sections, warnings, unknownSections } = yield* parseDossier(path.join(bundleDir, "dossier.md"));

  if (options.json) {
    return ok(
      `${JSON.stringify({
        bundle: slug,
        job: sections.job ?? null,
        contexts: sections.contexts,
        outOfScope: sections.outOfScope ?? null,
        basis: sections.basis ?? null,
        evidence: sections.evidence ?? null,
        fitCriterion: sections.fitCriterion ?? null,
        warnings: warnings,
        unknownSections: unknownSections,
      })}\n`,
    );
  }

  const gap = (label: string, value: string | undefined): string => `${label}: ${value ?? "unrecorded"}`;
  const lines = [
    `bundle:        ${slug}`,
    gap("job", sections.job),
    sections.contexts.length > 0
      ? `contexts:      ${sections.contexts.map((c) => c.name).join(", ")}`
      : "contexts:      unrecorded",
    gap("out-of-scope", sections.outOfScope),
    gap("basis", sections.basis),
    gap("evidence", sections.evidence),
    gap("fit criterion", sections.fitCriterion),
  ];
  if (warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of warnings) {
      lines.push(`  ${warning}`);
    }
  }
  if (unknownSections.length > 0) {
    lines.push(`unrecognized sections: ${unknownSections.map((s) => s.heading).join(", ")}`);
  }
  return ok(`${lines.join("\n")}\n`);
});
