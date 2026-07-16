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
 *
 * Issue #92 adds two more modes, and a tripwire on this one:
 *
 * - `adopt --triage [path]`: acts on nothing. Runs the same discovery sweep
 *   plus the registry/paperwork tripwire, and writes `adopt-manifest.md` at
 *   the workspace root -- one row per discovered skill, machine columns
 *   pre-filled, human columns at their deferral defaults.
 * - `adopt --from-manifest [file]`: reads that manifest back (default
 *   `adopt-manifest.md` at the workspace root) and executes each row as an
 *   individual act.
 * - Plain `adopt` gains the tripwire itself (`Mechanism - Receiving Dock.md`
 *   §HOW: "the non-triage sweep gains the registry/paperwork check"): a
 *   candidate the registry can prove is an arrival (hash-match,
 *   name-collision, foreign adopt marker) is challenged -- listed, not
 *   adopted -- rather than silently stamped.
 */
import {
  adoptWorkspace,
  computeBundleHashes,
  executeManifest,
  gatherIntakeRegistry,
  IndexServiceLayer,
  Journal,
  JournalLayer,
  parseManifest,
  recordSkillVersion,
  renderManifest,
  triageWorkspace,
  Workspace,
  type IntakeEvidence,
} from "@skillmaker/core";
import type { AdoptedSkill, AdoptReport, ChallengedSkill, ExecuteManifestSummary, TriageRow } from "@skillmaker/core";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { resolveUserActor } from "../ActorResolver.ts";
import { type CliResult, expectedFailure, ok } from "../CliResult.ts";

export interface AdoptOptions {
  readonly json: boolean;
  /** Fix (Phase 20 Story 3 friction log, upstream provenance): `adopt --source <url-or-path>` -- applies to every skill adopted in this batch. */
  readonly source?: string;
  /** `adopt --source ... --ref <ref>` -- ignored without `--source`. */
  readonly ref?: string;
}

const MANIFEST_FILENAME = "adopt-manifest.md";

const renderEvidenceForHuman = (evidence: IntakeEvidence): string => {
  switch (evidence.kind) {
    case "hash-match":
      return `hash matches recorded version of "${evidence.bundle}"`;
    case "name-collision":
      return `name collides with existing bundle "${evidence.bundle}"`;
    case "foreign-marker":
      return "carries a foreign adopt marker";
    case "bare":
      return "bare";
  }
};

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

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();

  const report = yield* Effect.gen(function* () {
    const journal = yield* Journal;
    const events = yield* journal.readAll();
    // The registry/paperwork tripwire (issue #92, `Mechanism - Receiving
    // Dock.md` §HOW): plain `adopt` now hash- and name-checks every
    // candidate against the registry before adopting it -- an
    // evidence-bearing candidate is challenged (listed below), never
    // silently stamped.
    const registry = yield* gatherIntakeRegistry(events).pipe(Effect.provide(IndexServiceLayer(resolved.root)));

    const adoptReport = yield* adoptWorkspace(root, { source: options.source, ref: options.ref, registry });

    for (const skill of adoptReport.adopted) {
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

    return adoptReport;
  }).pipe(Effect.provide(JournalLayer(journalPath)));

  return summarize(report, options.json, options.source, options.ref);
});

const summarize = (
  report: AdoptReport,
  json: boolean,
  source: string | undefined,
  ref: string | undefined,
): CliResult => {
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
        challenged: report.challenged.map((c) => ({ path: c.relativePath, evidence: c.evidence })),
        warnings: report.warnings,
        manifests: report.manifests,
        evalInfra: report.evalInfra,
        // Fix (Phase 20 Story 3 friction log, upstream provenance): only
        // present when --source was passed; applies to every skill adopted
        // in THIS batch (report.adopted), not skipped/already-adopted ones.
        ...(source !== undefined ? { upstream: { source, ref: ref ?? null } } : {}),
      })}\n`,
    );
  }

  const lines = [
    `skillmaker: adopt -- found ${report.found} SKILL.md file(s), adopted ${report.adopted.length}, skipped ${report.skipped.length} (already adopted), challenged ${report.challenged.length}`,
    ...(source !== undefined ? [`upstream:    ${source}${ref !== undefined ? ` @ ${ref}` : ""}`] : []),
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

  const printChallenge = (challenge: ChallengedSkill): void => {
    lines.push(`  ! ${challenge.relativePath} -- ${renderEvidenceForHuman(challenge.evidence)}`);
  };

  if (report.challenged.length > 0) {
    lines.push(
      "challenged (these look like arrivals -- route via `skillmaker receive`, or re-run with `adopt --triage` to decide in bulk):",
    );
    for (const challenge of report.challenged) {
      printChallenge(challenge);
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

// ---------------------------------------------------------------------------
// adopt --triage
// ---------------------------------------------------------------------------

export interface AdoptTriageOptions {
  readonly json: boolean;
}

/**
 * `skillmaker adopt --triage [path]` (issue #92): acts on nothing. Runs
 * `triageWorkspace` (the discovery sweep plus the registry/paperwork
 * tripwire) and writes `adopt-manifest.md` at the WORKSPACE root (never
 * under `path`, so the file lands somewhere the maker expects it regardless
 * of which subtree was swept).
 */
export const runAdoptTriage = Effect.fn("runAdoptTriage")(function* (
  cwd: string,
  targetPath: string | undefined,
  options: AdoptTriageOptions,
) {
  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker adopt --triage: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const fs = yield* FileSystem;
  const root = targetPath === undefined ? resolved.root : path.resolve(cwd, targetPath);
  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");

  const result = yield* triageWorkspace(resolved.root, root).pipe(Effect.provide(JournalLayer(journalPath)));

  const manifestPath = path.join(resolved.root, MANIFEST_FILENAME);
  yield* fs.writeFileString(manifestPath, renderManifest(result.rows));

  const evidenceCounts = { hashMatch: 0, nameCollision: 0, foreignMarker: 0, bare: 0 };
  for (const row of result.rows) {
    switch (row.evidence.kind) {
      case "hash-match":
        evidenceCounts.hashMatch++;
        break;
      case "name-collision":
        evidenceCounts.nameCollision++;
        break;
      case "foreign-marker":
        evidenceCounts.foreignMarker++;
        break;
      case "bare":
        evidenceCounts.bare++;
        break;
    }
  }

  if (options.json) {
    return ok(
      `${JSON.stringify({
        manifest: manifestPath,
        rows: result.rows.length,
        skipped: result.skipped,
        evidence: evidenceCounts,
        warnings: result.warnings,
      })}\n`,
    );
  }

  const lines = [
    `skillmaker: adopt --triage -- wrote ${manifestPath}`,
    `${result.rows.length} row(s): ${evidenceCounts.bare} bare (default "keep"/"mine"), ${
      evidenceCounts.hashMatch
    } hash-match, ${evidenceCounts.nameCollision} name-collision, ${evidenceCounts.foreignMarker} foreign-marker (evidence-bearing default "keep"/"receive")`,
  ];
  if (result.skipped.length > 0) {
    lines.push(`${result.skipped.length} already-adopted director(y/ies) skipped (already have identity)`);
  }
  if (result.warnings.length > 0) {
    lines.push("warnings:");
    for (const warning of result.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }
  lines.push("Edit the manifest, then run `skillmaker adopt --from-manifest` to execute it.");

  return ok(`${lines.join("\n")}\n`);
});

// ---------------------------------------------------------------------------
// adopt --from-manifest
// ---------------------------------------------------------------------------

export interface AdoptFromManifestOptions {
  readonly json: boolean;
}

/**
 * `skillmaker adopt --from-manifest [file]` (issue #92): reads the manifest
 * back (default `adopt-manifest.md` at the workspace root) and executes
 * every row as an individual act (`executeManifest`, `Triage.ts`). Every
 * row is reported -- adopted, received, archived, skipped, or errored --
 * no silent truncation.
 */
export const runAdoptFromManifest = Effect.fn("runAdoptFromManifest")(function* (
  cwd: string,
  manifestFile: string | undefined,
  options: AdoptFromManifestOptions,
) {
  const workspace = yield* Workspace;
  const resolved = yield* workspace
    .resolve(cwd)
    .pipe(Effect.catchTag("WorkspaceNotFoundError", () => Effect.succeed(undefined)));

  if (resolved === undefined) {
    return expectedFailure(
      "skillmaker adopt --from-manifest: no skillmaker workspace found (run `skillmaker init` first)\n",
    );
  }

  const path = yield* Path;
  const fs = yield* FileSystem;
  const manifestPath =
    manifestFile === undefined ? path.join(resolved.root, MANIFEST_FILENAME) : path.resolve(cwd, manifestFile);

  const manifestExists = yield* fs.exists(manifestPath);
  if (!manifestExists) {
    return expectedFailure(
      `skillmaker adopt --from-manifest: no manifest found at "${manifestPath}" (run \`skillmaker adopt --triage\` first)\n`,
    );
  }

  const content = yield* fs.readFileString(manifestPath);
  const { rows, warnings: parseWarnings } = parseManifest(content);

  const journalPath = path.join(resolved.root, ".skillmaker", "events.jsonl");
  const actor = yield* resolveUserActor();
  const summary = yield* executeManifest(resolved.root, rows, actor).pipe(Effect.provide(JournalLayer(journalPath)));

  return summarizeExecution(manifestPath, rows, summary, parseWarnings, options.json);
});

const summarizeExecution = (
  manifestPath: string,
  rows: ReadonlyArray<TriageRow>,
  summary: ExecuteManifestSummary,
  parseWarnings: ReadonlyArray<string>,
  json: boolean,
): CliResult => {
  if (json) {
    return ok(
      `${JSON.stringify({
        manifest: manifestPath,
        rowsRead: rows.length,
        adopted: summary.adopted,
        received: summary.received,
        archived: summary.archived,
        skipped: summary.skipped,
        errored: summary.errored,
        todosMinted: summary.todosMinted,
        outcomes: summary.outcomes,
        warnings: parseWarnings,
      })}\n`,
    );
  }

  const lines = [
    `skillmaker: adopt --from-manifest ${manifestPath}`,
    `${summary.adopted} adopted, ${summary.received} received to dock, ${summary.archived} archived, ${summary.skipped} skipped, ${summary.errored} errored, ${summary.todosMinted} todo(s) minted`,
  ];
  for (const outcome of summary.outcomes) {
    switch (outcome.kind) {
      case "adopted":
        lines.push(`  + adopted ${outcome.slug} <- ${outcome.path}`);
        break;
      case "archived":
        lines.push(`  + archived ${outcome.slug} <- ${outcome.path}`);
        break;
      case "received":
        lines.push(`  + received ${outcome.path} -- intake ${outcome.intake} (verdict: ${outcome.verdict})`);
        break;
      case "skipped":
        lines.push(`  - skipped ${outcome.path} (${outcome.reason})`);
        break;
      case "errored":
        lines.push(`  ! error on ${outcome.path}: ${outcome.message}`);
        break;
    }
  }
  if (parseWarnings.length > 0) {
    lines.push("manifest warnings:");
    for (const warning of parseWarnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  return ok(`${lines.join("\n")}\n`);
};
