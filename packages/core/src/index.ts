/**
 * @skillmaker/core — v1 domain model + services.
 *
 * Translated from docs/plans/2026-07-10-playmaker-to-skillmaker-migration/data-model.md.
 * The canonical-store split: content lives in files (`skills/<slug>/`), state
 * and decisions live in the append-only journal (`.skillmaker/events.jsonl`),
 * and SQLite is a rebuildable index (`studio.db`, rebuilt via the journal
 * fold + a file scan — never a source of truth).
 */

export * from "./Actor.ts";
export * from "./Bundle.ts";
export * from "./Stations.ts";
export * from "./Run.ts";
export * from "./Todo.ts";
export * from "./Journal.ts";
export * from "./Workspace.ts";
export * from "./Errors.ts";
export { foldBundleStates, bundleForEvent } from "./Fold.ts";
export {
  foldTodos,
  isTerminalStatus,
  isArchived,
  compareTodos,
  isoDateOnly,
  DEFAULT_PRIORITY_BY_KIND,
  ARCHIVE_WINDOW_DAYS,
} from "./FoldTodos.ts";
export {
  STAGES,
  checkTransition,
  guardStatus,
  type TransitionVerdict,
  type CheckTransitionInput,
  type GuardStatus,
} from "./Machine.ts";

export { Journal, layer as JournalLayer, type AppendResult } from "./JournalService.ts";
export {
  Workspace,
  layer as WorkspaceLayer,
  isValidSlug,
  type CreateBundleInput,
} from "./WorkspaceService.ts";
export {
  IndexService,
  layer as IndexServiceLayer,
  type BundleRecord,
  type TodoRecord,
  type VersionRecord,
  type ListTodosOptions,
  type RebuildResult,
} from "./IndexService.ts";
export {
  hashFile,
  hashOutputTree,
  hashDesign,
  computeBundleHashes,
  computeDrift,
  foldSkillVersions,
  latestSkillVersion,
  shortHash,
  type BundleHashes,
  type Drift,
  type SkillVersion,
} from "./Versions.ts";
