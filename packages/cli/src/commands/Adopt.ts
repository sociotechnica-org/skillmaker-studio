/**
 * `skillmaker adopt [path]` -- brownfield import (strategy-skills-repo-mode.md
 * §3B, plan.md Phase 16). Discovers `SKILL.md` files under `path` (default
 * cwd) and wraps each in place as a bundle (`@skillmaker/core`'s
 * `adoptWorkspace`, filesystem-only), then journals `bundle.created` (+
 * `bundle.archived` for a `deprecated/`-pathname skill) and an initial
 * `skill.version_recorded` per newly adopted skill -- mirroring how `new`
 * layers journal writes on top of `Workspace.createBundle` (`New.ts`) and
 * how `version record` computes+records hashes (`Version.ts`).
 *
 * Requires an existing workspace (`skillmaker init` first) -- adopt runs on
 * top of a workspace, it does not create one.
 */
import {
  adoptWorkspace,
  computeBundleHashes,
  Journal,
  JournalLayer,
  recordSkillVersion,
  Workspace,
} from "@skillmaker/core";
import type { AdoptedSkill, AdoptReport } from "@skillmaker/core";
import { Effect } from "effect";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok } from "../CliResult.ts";

export interface AdoptOptions {
  readonly json: boolean;
}

export const runAdopt = Effect.fn("runAdopt")(function* (
  cwd: string,
  targetPath: string | undefined,
  options: AdoptOptions,
) {
  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker adopt: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const root = targetPath === undefined ? resolved.root : path.resolve(cwd, targetPath);

  const report = yield* adoptWorkspace(root);

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  yield* Effect.gen(function* () {
    const journal = yield* Journal;
    for (const skill of report.adopted) {
      yield* journal.append({
        type: "bundle.created",
        actor,
        idempotencyKey: `bundle.created:${skill.slug}`,
        payload: { bundle: skill.slug },
      });

      if (skill.lifecycle === "archived") {
        yield* journal.append({
          type: "bundle.archived",
          actor,
          idempotencyKey: `bundle.archived:${skill.slug}`,
          payload: { bundle: skill.slug },
        });
      }

      const { designHash, outputHash } = yield* computeBundleHashes(skill.dir, "in-place");
      yield* recordSkillVersion(skill.slug, actor, designHash, outputHash, { label: "adopted" });
    }
  }).pipe(Effect.provide(JournalLayer(journalPath)));

  return summarize(report, options.json);
});

const summarize = (report: AdoptReport, json: boolean): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({
        found: report.found,
        adopted: report.adopted.map((skill) => ({
          slug: skill.slug,
          path: skill.relativePath,
          lifecycle: skill.lifecycle,
          generated: skill.generated,
          warnings: skill.warnings,
        })),
        skipped: report.skipped,
        warnings: report.warnings,
        manifests: report.manifests,
        evalInfra: report.evalInfra,
      })}\n`,
    );
  }

  const lines = [
    `skillmaker: adopt -- found ${report.found} SKILL.md file(s), adopted ${report.adopted.length}, skipped ${report.skipped.length} (already adopted)`,
  ];

  const printSkill = (skill: AdoptedSkill): void => {
    const flags = [
      skill.lifecycle === "archived" ? "archived" : undefined,
      skill.generated ? "generated" : undefined,
    ].filter((flag): flag is string => flag !== undefined);
    const suffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    lines.push(`  + ${skill.slug} <- ${skill.relativePath}${suffix}`);
    for (const warning of skill.warnings) {
      lines.push(`      warning: ${warning}`);
    }
  };

  if (report.adopted.length > 0) {
    lines.push("adopted:");
    for (const skill of report.adopted) {
      printSkill(skill);
    }
  }

  if (report.skipped.length > 0) {
    lines.push("skipped (already adopted):");
    for (const skip of report.skipped) {
      lines.push(`  - ${skip.relativePath}`);
    }
  }

  if (report.manifests.length > 0) {
    lines.push("manifests detected:");
    for (const manifest of report.manifests) {
      lines.push(`  - ${manifest.relativePath} (${manifest.kind})`);
    }
  }

  if (report.evalInfra.length > 0) {
    lines.push("eval/test infra detected (report-only; not imported):");
    for (const infra of report.evalInfra) {
      lines.push(`  - ${infra.relativePath} (${infra.kind})`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of report.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  return ok(`${lines.join("\n")}\n`);
};
