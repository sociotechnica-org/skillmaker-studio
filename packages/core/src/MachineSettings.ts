/**
 * Machine-level settings (director ruling R9, 2026-08-11): ONE file,
 * `~/.skillmaker-studio/settings.json` — a sibling of the machine project
 * registry (`MachineConfig.ts`'s `config.json`, same home dir, same
 * `SKILLMAKER_STUDIO_HOME` override for tests/parallel instances). Shape:
 *
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "defaults": { "provider": "claude-code", "model": "...", "runTimeoutSeconds": 600 }
 * }
 * ```
 *
 * Behavior contract: an ABSENT file is exactly today's behavior (built-in
 * hardcoded defaults). When present, its `defaults` fill in wherever run
 * dispatch (CLI `skillmaker run`, the server's run-dispatch doors) would
 * otherwise fall back to a hardcoded provider/model/timeout default.
 * Explicit per-run choices (CLI flags, request-body fields) ALWAYS win.
 *
 * Tolerance law — the `EvalsJson.ts` trichotomy, NOT `MachineConfig.ts`'s
 * loud error (a corrupt registry could lose projects on the next write; a
 * corrupt settings file merely means "no machine defaults today"):
 * - `absent`   — no file: fine, no warning, empty defaults.
 * - `unusable` — a file exists but isn't a JSON object: warned, empty
 *   defaults, callers proceed with built-ins.
 * - `parsed`   — the envelope held; each defective field degrades to a
 *   warning + skip, never a whole-file failure. Unknown keys (in the
 *   envelope AND inside `defaults`) pass through silently — the schema is
 *   deliberately tolerant so future keys (e.g. the provider→harness rename)
 *   never break older readers.
 *
 * Deliberately synchronous `node:fs`, same style as `MachineConfig.ts`:
 * one tiny JSON file, read per dispatch so edits take effect without a
 * server restart. Read-side only — nothing here writes settings.json.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MACHINE_SETTINGS_FILENAME = "settings.json";

export const machineSettingsPath = (home: string): string => join(home, MACHINE_SETTINGS_FILENAME);

/** The built-in provider default every dispatch door used before machine settings existed. */
export const DEFAULT_RUN_PROVIDER = "claude-code";

/** Machine-level run defaults. Every field optional: an omitted field means "keep the built-in default". */
export interface MachineRunDefaults {
  readonly provider?: string;
  readonly model?: string;
  readonly runTimeoutSeconds?: number;
}

/** `absent` — no file (fine, no warning). `unusable` — file exists but is not a JSON object (warned; built-ins apply). `parsed` — envelope held; defective fields warned and skipped individually. */
export type MachineSettingsStatus = "absent" | "unusable" | "parsed";

export interface ReadMachineSettingsResult {
  readonly status: MachineSettingsStatus;
  readonly defaults: MachineRunDefaults;
  readonly warnings: ReadonlyArray<string>;
}

const NO_DEFAULTS: MachineRunDefaults = {};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads `<home>/settings.json` tolerantly. NEVER throws: any defect —
 * unreadable file, bad JSON, wrong shapes, wrong field types — degrades to
 * warnings, and the caller proceeds with whatever defaults survived
 * (possibly none). Callers surface `warnings` on their own channel (CLI
 * stderr, server log).
 */
export const readMachineSettings = (home: string): ReadMachineSettingsResult => {
  const path = machineSettingsPath(home);
  if (!existsSync(path)) {
    return { status: "absent", defaults: NO_DEFAULTS, warnings: [] };
  }

  const warnings: string[] = [];
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (cause) {
    warnings.push(`machine settings at ${path} could not be read (${String(cause)}); using built-in defaults`);
    return { status: "unusable", defaults: NO_DEFAULTS, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    warnings.push(
      `machine settings at ${path} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); using built-in defaults`,
    );
    return { status: "unusable", defaults: NO_DEFAULTS, warnings };
  }

  if (!isPlainObject(parsed)) {
    warnings.push(`machine settings at ${path}: top level is not an object; using built-in defaults`);
    return { status: "unusable", defaults: NO_DEFAULTS, warnings };
  }

  // Tolerant versioning: an unknown schemaVersion is warned but still read
  // (unknown keys pass through; a future version that keeps these keys keeps
  // working). Only `1` and "absent" are silent.
  const schemaVersion = parsed["schemaVersion"];
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    warnings.push(
      `machine settings at ${path}: unexpected schemaVersion ${JSON.stringify(schemaVersion)} (expected 1); reading tolerantly`,
    );
  }

  const rawDefaults = parsed["defaults"];
  if (rawDefaults === undefined) {
    return { status: "parsed", defaults: NO_DEFAULTS, warnings };
  }
  if (!isPlainObject(rawDefaults)) {
    warnings.push(`machine settings at ${path}: "defaults" is not an object; using built-in defaults`);
    return { status: "parsed", defaults: NO_DEFAULTS, warnings };
  }

  const defaults: { provider?: string; model?: string; runTimeoutSeconds?: number } = {};

  for (const key of ["provider", "model"] as const) {
    const value = rawDefaults[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      warnings.push(`machine settings at ${path}: defaults.${key} is not a non-empty string; ignored`);
      continue;
    }
    defaults[key] = value.trim();
  }

  const rawTimeout = rawDefaults["runTimeoutSeconds"];
  if (rawTimeout !== undefined) {
    if (typeof rawTimeout !== "number" || !Number.isFinite(rawTimeout) || rawTimeout <= 0) {
      warnings.push(`machine settings at ${path}: defaults.runTimeoutSeconds is not a positive number; ignored`);
    } else {
      defaults.runTimeoutSeconds = rawTimeout;
    }
  }

  return { status: "parsed", defaults, warnings };
};

/** An explicit per-run choice at one dispatch door: a CLI flag or a request-body field. `undefined` means "not chosen for this run". */
export interface ExplicitRunChoices {
  readonly provider?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

/** What a dispatch door passes to `RunEngine.runFixture`. `model`/`timeoutMs` stay `undefined` when nothing chose them — the adapter's own model default and the engine's own timeout apply, exactly as before machine settings existed. */
export interface ResolvedRunChoices {
  readonly provider: string;
  readonly model?: string;
  readonly timeoutMs?: number;
}

/**
 * THE precedence rule, one place, every dispatch door: explicit per-run
 * choice > machine settings.json default > built-in default. Built-ins are
 * `DEFAULT_RUN_PROVIDER` for provider and "absent" for model/timeout (the
 * adapter and engine keep their own downstream defaults).
 */
export const resolveRunChoices = (
  machineDefaults: MachineRunDefaults,
  explicit: ExplicitRunChoices,
): ResolvedRunChoices => {
  const model = explicit.model ?? machineDefaults.model;
  const timeoutMs =
    explicit.timeoutMs ??
    (machineDefaults.runTimeoutSeconds !== undefined
      ? Math.round(machineDefaults.runTimeoutSeconds * 1000)
      : undefined);
  return {
    provider: explicit.provider ?? machineDefaults.provider ?? DEFAULT_RUN_PROVIDER,
    ...(model !== undefined ? { model } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
};
