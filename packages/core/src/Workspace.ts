/**
 * `skillmaker.config.json` (data-model.md §2.2).
 */
import { Schema } from "effect";

export class ProviderConfig extends Schema.Class<ProviderConfig>("ProviderConfig")({
  command: Schema.Array(Schema.String),
}) {}

export class ViewerConfig extends Schema.Class<ViewerConfig>("ViewerConfig")({
  port: Schema.Number,
}) {}

export class PublishTarget extends Schema.Class<PublishTarget>("PublishTarget")({
  id: Schema.String,
  kind: Schema.String,
  path: Schema.String,
}) {}

export class WorkspaceConfig extends Schema.Class<WorkspaceConfig>("WorkspaceConfig")({
  schemaVersion: Schema.Literal(1),
  name: Schema.String,
  skillsDir: Schema.String,
  viewer: ViewerConfig,
  /** [Ruling G] `runs/` are git-tracked by default; escape hatch to opt out. */
  trackRuns: Schema.Boolean,
  providers: Schema.Record(Schema.String, ProviderConfig),
  publishTargets: Schema.Array(PublishTarget),
}) {}

/** The workspace config plus where it (and thus the workspace root) live. */
export class ResolvedWorkspace extends Schema.Class<ResolvedWorkspace>("ResolvedWorkspace")({
  root: Schema.String,
  config: WorkspaceConfig,
}) {}

export const DEFAULT_CONFIG_FILENAME = "skillmaker.config.json";
export const JOURNAL_RELATIVE_PATH = ".skillmaker/events.jsonl";

export const defaultConfig = (name: string): typeof WorkspaceConfig.Type => ({
  schemaVersion: 1,
  name,
  skillsDir: "skills",
  viewer: { port: 4323 },
  trackRuns: true,
  providers: {
    "claude-code": { command: ["npx", "-y", "@zed-industries/claude-code-acp@latest"] },
    // `@agentclientprotocol/codex-acp` (not the npm-deprecated
    // `@zed-industries/codex-acp`) rides the machine's already-logged-in
    // `codex` CLI over ChatGPT auth, exactly like the claude-code provider
    // rides `claude`. Validated with a real handshake (docs/plans/2026-07-10
    // -playmaker-to-skillmaker-migration/data-model.md's provider section,
    // Phase 12): this package's model catalog tracks the installed CLI, so
    // no `-c model=<id>` pin is needed (unlike the deprecated zed package,
    // which can trail the CLI's default model and fail session/prompt with
    // JSON-RPC -32603 "requires a newer version of Codex" -- see
    // AcpClient.ts's CODEX_INFRA_STDERR_SIGNATURES).
    codex: { command: ["npx", "-y", "@agentclientprotocol/codex-acp@latest"] },
  },
  publishTargets: [],
});
