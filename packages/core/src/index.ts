/**
 * @skillmaker/core — v1 domain model + services.
 *
 * Translated from docs/_archive/plans/2026-07-10-playmaker-to-skillmaker-migration/data-model.md.
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
export { CUSTODY_EVENT_TYPES, custodyEventsFor } from "./Lineage.ts";
export { foldLastShipments, foldLastActivityAt, type LastShipment } from "./Whereabouts.ts";
export {
  foldTodos,
  isTerminalStatus,
  isSwept,
  compareTodos,
  isoDateOnly,
  DEFAULT_PRIORITY_BY_KIND,
  SWEEP_WINDOW_DAYS,
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
  type BundleLocation,
  type BundleRecord,
  type BundleUpstream,
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
  writeFixtureScaffold,
  FIXTURE_CLASSES,
  FixtureClass,
  isFixtureClass,
  RISK_FAMILIES,
  riskFamily,
  isKnownRiskFamily,
  FixtureCase,
  FixtureSetup,
  FixtureGrading,
  FixtureSource,
  FixtureSourceFieldReport,
  FixtureSourceIntake,
  type RiskFamily,
  type FixtureSourceRecord,
  type FixtureCaseRecord,
  type ScanFixturesResult,
  type FixtureScaffoldInput,
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
  parseDossier,
  writeDossierScaffold,
  DOSSIER_SECTIONS,
  type DossierSectionName,
  type DossierContext,
  type DossierSeed,
  type DossierUnknownSection,
  type DossierSections,
  type ParseDossierResult,
} from "./Dossier.ts";
export {
  hashFile,
  hashOutputTree,
  hashDesign,
  computeBundleHashes,
  computeDrift,
  detectBundleLayout,
  foldSkillVersions,
  latestSkillVersion,
  resolveSkillVersion,
  shortHash,
  versionLabel,
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
  adoptDirectoryInPlace,
  parseFrontmatter,
  slugify,
  walk,
  type WalkResult,
  AdoptMarker,
  AdoptUpstream,
  type AdoptedSkill,
  type AdoptWorkspaceOptions,
  type SkippedSkill,
  type ChallengedSkill,
  type AdoptReport,
  type Frontmatter,
  type FrontmatterValue,
  type ParsedFrontmatter,
  type SkillLifecycle,
  type AdoptDirectoryInput,
  type AdoptDirectoryResult,
  type AdoptDirectoryUpstream,
} from "./Adopt.ts";
export {
  HARNESS_KINDS,
  HARNESS_PRESENCE_DIR,
  HARNESS_SKILL_INSTALL_DIR,
  HARNESS_LABEL,
  detectHarnesses,
  registerSkill,
  type HarnessKind,
  type HarnessDetection,
  type SkillInstallResult,
} from "./Harness.ts";
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
  makeSandboxPermissionPolicy,
  permissiveApprovePolicy,
  type PermissionDecision,
  type PermissionPolicy,
  type PermissionPolicyResult,
  type PermissionCancelled,
  type PermissionOption,
  isPermissionCancelled,
  extractPermissionOptions,
  permissionPathsOutside,
  pickApproveOption,
  classifyAcpFailure,
} from "./AcpClient.ts";
export {
  startChatSession,
  makeChatPermissionPolicy,
  ChatBusyError,
  ChatClosedError,
  type ChatSessionError,
  type ChatSessionHandle,
  type ChatSessionOptions,
  type ChatPermissionAnswer,
  type ChatPermissionAsk,
} from "./ChatSession.ts";
export {
  runFixture,
  RunPreconditionError,
  FAILURE_CLASSIFICATION_TABLE,
  type RunFixtureInput,
  type RunFixtureResult,
  type RunProgressEvent,
} from "./RunEngine.ts";
export {
  repairRuns,
  RunRepairNotFoundError,
  type RunRepairInput,
  type RepairedRun,
} from "./RunRepair.ts";
export { seedProviderAuth, type AuthSeedResult } from "./AuthSeeding.ts";
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
export { shipBundle, type ShipBundleInput, type ShipBundleResult } from "./Ship.ts";
export {
  recordFieldReport,
  type RecordFieldReportInput,
  type RecordFieldReportResult,
} from "./FieldReport.ts";
export {
  harvestFixture,
  harvestFixtureFromIntake,
  type HarvestFixtureInput,
  type HarvestFixtureResult,
  type HarvestFixtureFromIntakeInput,
  type HarvestFixtureFromIntakeResult,
} from "./Harvest.ts";
export {
  openTodoFromReport,
  openTodoFromIntake,
  openTodoFromRun,
  TODO_KIND_BY_OUTCOME,
  type OpenTodoFromReportInput,
  type OpenTodoFromReportResult,
  type OpenTodoFromIntakeInput,
  type OpenTodoFromIntakeResult,
  type OpenTodoFromRunInput,
  type OpenTodoFromRunResult,
} from "./TodoFromReport.ts";
export {
  receiveCrate,
  newIntakeId,
  hashReceivedCrate,
  gatherIntakeRegistry,
  deriveIntakeVerdict,
  classifyIntakeEvidence,
  listUndisposedCrates,
  VERDICT_DISPOSITIONS,
  type IntakeVerdict,
  type IntakeEvidence,
  type IntakeRegistry,
  type IntakeRegistryBundle,
  type ReceiveCrateInput,
  type ReceiveCrateResult,
} from "./Receive.ts";
export {
  routeCrate,
  DISPOSITIONS,
  isRouteDisposition,
  ROUTE_ENTRY_STAGE_REASON,
  type RouteCrateInput,
  type RouteCrateResult,
} from "./Route.ts";
export {
  triageWorkspace,
  renderManifest,
  parseManifest,
  executeManifest,
  executeManifestRow,
  defaultWhoseFor,
  isTriageDecision,
  isTriageWhose,
  isTriageStakes,
  deriveEntryStage,
  TRIAGE_DECISIONS,
  TRIAGE_WHOSE_VALUES,
  TRIAGE_STAKES_VALUES,
  TRIAGE_ENTRY_STAGE_REASON,
  type TriageDecision,
  type TriageWhose,
  type TriageStakes,
  type TriageRow,
  type TriageSkippedRow,
  type TriageWorkspaceResult,
  type MechanicalCondition,
  type ParseManifestResult,
  type ExecuteRowOutcome,
  type ExecuteManifestRowResult,
  type ExecuteManifestSummary,
  type ExecuteManifestOptions,
} from "./Triage.ts";
export {
  IDENTITY_GRANTING_DISPOSITIONS,
  isIdentityGrantingDisposition,
  foldEverReceivedBundles,
  isUnverified,
} from "./Verification.ts";
