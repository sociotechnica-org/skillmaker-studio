/**
 * THE MERGE tranche 2: the ACP client moved to `@skillmaker/runner` (the
 * execution adapter package). Re-exported here so core's internal relative
 * imports (`ChatSession.ts`, `StationEngine.ts`, ...) and
 * `@skillmaker/core`'s public API are unchanged.
 */
export {
  AcpAuthError,
  AcpClient,
  type AcpClientOptions,
  type AcpError,
  AcpProtocolError,
  type AcpRunOptions,
  type AcpRunResult,
  AcpSpawnError,
  AcpTimeoutError,
  type CandidatePath,
  classifyAcpFailure,
  extractPermissionOptions,
  isPermissionCancelled,
  type JsonRpcId,
  makeSandboxPermissionPolicy,
  type PermissionCancelled,
  type PermissionDecision,
  type PermissionOption,
  type PermissionPolicy,
  type PermissionPolicyResult,
  permissionPathsOutside,
  permissiveApprovePolicy,
  pickApproveOption,
  resolveAdapterCommand,
  runAcpSession,
  stripClaudeCodeEnv,
  type TranscriptEntry,
} from "@skillmaker/runner";
