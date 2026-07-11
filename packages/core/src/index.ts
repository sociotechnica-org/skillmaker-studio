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
  type FixtureRecord,
  type RiskCoverageRecord,
  type WarningRecord,
  type RunIndexRecord,
} from "./IndexService.ts";
export {
  computeMeasurements,
  confidenceInterval,
  ruleOfThreeCi,
  wilsonCi,
  guidanceForN,
  GUIDANCE_LEVELS,
  SMOKE_K,
  ESTIMATE_K,
  SHIP_GATE_K,
  type MeasurementRecord,
  type GuidanceLevel,
} from "./Measurements.ts";
export {
  scanFixtures,
  FIXTURE_CLASSES,
  FixtureClass,
  RISK_FAMILIES,
  riskFamily,
  isKnownRiskFamily,
  FixtureCase,
  FixtureSetup,
  FixtureGrading,
  type RiskFamily,
  type FixtureCaseRecord,
  type ScanFixturesResult,
} from "./Fixtures.ts";
export {
  parseRiskMap,
  checkCoverage,
  parseCoverageCell,
  COVERAGE_VALUES,
  type CoverageValue,
  type RiskRow,
  type ParseRiskMapResult,
} from "./RiskMap.ts";
export {
  hashFile,
  hashOutputTree,
  hashDesign,
  computeBundleHashes,
  computeDrift,
  detectBundleLayout,
  foldSkillVersions,
  latestSkillVersion,
  shortHash,
  recordSkillVersion,
  skillVersionIdempotencyKey,
  ADOPT_MARKER_FILENAME,
  ADOPT_EXCLUDED_NAMES,
  type BundleHashes,
  type BundleLayout,
  type Drift,
  type SkillVersion,
  type HashOutputTreeOptions,
} from "./Versions.ts";
export {
  adoptWorkspace,
  parseFrontmatter,
  AdoptMarker,
  type AdoptedSkill,
  type SkippedSkill,
  type AdoptReport,
  type Frontmatter,
  type FrontmatterValue,
  type ParsedFrontmatter,
  type SkillLifecycle,
} from "./Adopt.ts";
export { didSkillActivate } from "./SkillActivation.ts";
export { extractResponseText, responseMarkdown } from "./RunResponse.ts";
export {
  resolveProviderProfile,
  CLAUDE_CODE_PROFILE,
  CODEX_PROFILE,
  CLAUDE_CODE_PROVIDER_ID,
  CODEX_PROVIDER_ID,
  CODEX_MODEL_COMPAT_STDERR_SIGNATURE,
  type ProviderProfile,
  type SessionModelSource,
} from "./ProviderProfile.ts";
export {
  AcpClient,
  runAcpSession,
  stripClaudeCodeEnv,
  AcpSpawnError,
  AcpAuthError,
  AcpProtocolError,
  AcpTimeoutError,
  type AcpError,
  type AcpClientOptions,
  type AcpRunOptions,
  type AcpRunResult,
  type TranscriptEntry,
  type JsonRpcId,
} from "./AcpClient.ts";
export {
  runFixture,
  RunPreconditionError,
  FAILURE_CLASSIFICATION_TABLE,
  type RunFixtureInput,
  type RunFixtureResult,
  type RunProgressEvent,
} from "./RunEngine.ts";
export {
  runStation,
  StationPreconditionError,
  buildStationPrompt,
  buildReviewQuestion,
  latestReviseNotes,
  type RunStationInput,
  type RunStationResult,
  type StationProgressEvent,
  type BuildStationPromptInput,
} from "./StationEngine.ts";
export {
  detectNonDiscriminatingChecks,
  formatSelfCritiqueWarning,
  MIN_GRADED_RUNS_FOR_SELF_CRITIQUE,
  type GradedRunChecks,
  type NonDiscriminatingCheck,
} from "./GraderSelfCritique.ts";
export {
  checkPublishable,
  publishBundle,
  publishGitDir,
  publishClaudeMarketplace,
  publishCodexMarketplace,
  type PublishGuardResult,
  type GitDirPublishResult,
  type ClaudeMarketplacePublishResult,
  type CodexMarketplacePublishResult,
  type PublishTargetResult,
  type PublishBundleResult,
  type PublishBundleInput,
} from "./Publish.ts";
