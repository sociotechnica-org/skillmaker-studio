import { describe, expect, test } from "bun:test";
import {
  CLAUDE_CODE_PROFILE,
  CODEX_MODEL_COMPAT_STDERR_SIGNATURE,
  CODEX_PROFILE,
  resolveModelLabel,
  resolveProviderProfile,
} from "../src/ProviderProfile.ts";

describe("resolveProviderProfile", () => {
  test('"claude-code" resolves to the claude-code profile, skill dir .claude/skills', () => {
    const profile = resolveProviderProfile("claude-code");
    expect(profile).toBe(CLAUDE_CODE_PROFILE);
    expect(profile.skillInstallDir).toBe(".claude/skills");
  });

  test('"codex" resolves to the codex profile, skill dir .agents/skills', () => {
    const profile = resolveProviderProfile("codex");
    expect(profile).toBe(CODEX_PROFILE);
    expect(profile.skillInstallDir).toBe(".agents/skills");
  });

  test("an unrecognized provider id falls back to the claude-code profile rather than failing", () => {
    const profile = resolveProviderProfile("some-future-provider");
    expect(profile).toBe(CLAUDE_CODE_PROFILE);
  });

  test("codex's infra-stderr signatures include the model-compat class of fault (spike-codex/FINDINGS.md)", () => {
    expect(CODEX_PROFILE.infraStderrSignatures).toContain(CODEX_MODEL_COMPAT_STDERR_SIGNATURE);
  });

  test("claude-code's infra-stderr signatures are empty (its own nested-session signature lives in AcpClient.ts's provider-agnostic list)", () => {
    expect(CLAUDE_CODE_PROFILE.infraStderrSignatures).toEqual([]);
  });

  // Fix F6: each profile names the env var ITS OWN CLI respects to relocate
  // its whole config directory (including user-level skills), so
  // RunEngine/StationEngine can point the adapter subprocess at an
  // isolated, run-scoped directory instead of the operator's real one.
  test('claude-code profile\'s configDirEnvVar is "CLAUDE_CONFIG_DIR" (respected by the claude CLI claude-code-acp wraps)', () => {
    expect(CLAUDE_CODE_PROFILE.configDirEnvVar).toBe("CLAUDE_CONFIG_DIR");
  });

  test('codex profile\'s configDirEnvVar is "CODEX_HOME" (respected by the codex CLI codex-acp wraps), distinct from claude-code\'s', () => {
    expect(CODEX_PROFILE.configDirEnvVar).toBe("CODEX_HOME");
    expect(CODEX_PROFILE.configDirEnvVar).not.toBe(CLAUDE_CODE_PROFILE.configDirEnvVar);
  });
});

describe("extractModel -- both session/new shapes (spike-codex/FINDINGS.md's protocol delta table)", () => {
  test("claude-code shape: models.currentModelId", () => {
    const session = { sessionId: "s1", models: { currentModelId: "claude-opus-x" } };
    expect(CLAUDE_CODE_PROFILE.extractModel(session)).toBe("claude-opus-x");
    expect(CODEX_PROFILE.extractModel(session)).toBe("claude-opus-x");
  });

  test("codex @agentclientprotocol/codex-acp shape: also models.currentModelId (re-spiked for Phase 12, no configOptions needed)", () => {
    const session = {
      sessionId: "s1",
      models: { currentModelId: "gpt-5.6-sol[xhigh]", availableModels: [] },
      configOptions: [{ id: "model", currentValue: "gpt-5.6-sol[xhigh]" }],
    };
    expect(CODEX_PROFILE.extractModel(session)).toBe("gpt-5.6-sol[xhigh]");
  });

  test("legacy @zed-industries/codex-acp shape: configOptions[id=\"model\"].currentValue, no models key at all", () => {
    const session = {
      sessionId: "s1",
      configOptions: [
        { id: "approval_policy", currentValue: "auto" },
        { id: "model", currentValue: "gpt-5.4" },
      ],
    };
    expect(CODEX_PROFILE.extractModel(session)).toBe("gpt-5.4");
    // The generic tolerant extractor works the same regardless of which
    // profile it's attached to -- both shapes are tried unconditionally.
    expect(CLAUDE_CODE_PROFILE.extractModel(session)).toBe("gpt-5.4");
  });

  test("neither shape present -> null, not a throw", () => {
    expect(CLAUDE_CODE_PROFILE.extractModel({ sessionId: "s1" })).toBeNull();
    expect(CODEX_PROFILE.extractModel({ sessionId: "s1", configOptions: [] })).toBeNull();
  });
});

// Fix 2 (Phase 20 Story 2 friction log F2): `currentModelId` is a PROTOCOL
// ALIAS ("default"/"sonnet"/"haiku"), not a stable model identity --
// "default" resolves to whatever the account's default is *that day*. This
// module must always resolve it against `availableModels`' `description`
// before it becomes `run.json`'s/measurements' `model` field, so two runs
// both showing "default" are never silently pooled as the same real model.
describe("resolveModelLabel / extractModel resolve the alias to its advertised description (Fix 2, closes the pooling hazard)", () => {
  const sessionWithDescriptions = {
    sessionId: "s1",
    models: {
      currentModelId: "default",
      availableModels: [
        { modelId: "default", name: "Default (recommended)", description: "Opus 4.6 - Most capable for complex work" },
        { modelId: "sonnet", name: "Sonnet", description: "Sonnet 4.6 - Balanced" },
      ],
    },
  };

  test('resolveModelLabel("default") returns the matched entry\'s description, not the bare alias', () => {
    expect(resolveModelLabel(sessionWithDescriptions, "default")).toBe(
      "Opus 4.6 - Most capable for complex work",
    );
  });

  test("resolveModelLabel for a requested (non-current) advertised id also resolves, e.g. after session/set_model", () => {
    expect(resolveModelLabel(sessionWithDescriptions, "sonnet")).toBe("Sonnet 4.6 - Balanced");
  });

  test("resolveModelLabel falls back to the bare id when no matching availableModels entry exists (defensive, never throws)", () => {
    expect(resolveModelLabel(sessionWithDescriptions, "unknown-id")).toBe("unknown-id");
    expect(resolveModelLabel({ sessionId: "s1" }, "default")).toBe("default");
  });

  test("CLAUDE_CODE_PROFILE.extractModel resolves \"default\" through the same mechanism -- run.json's model field never stores the literal alias when a description is advertised", () => {
    const resolved = CLAUDE_CODE_PROFILE.extractModel(sessionWithDescriptions);
    expect(resolved).toBe("Opus 4.6 - Most capable for complex work");
    expect(resolved).not.toBe("default");
  });
});
