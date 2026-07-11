import { describe, expect, test } from "bun:test";
import {
  CLAUDE_CODE_PROFILE,
  CODEX_MODEL_COMPAT_STDERR_SIGNATURE,
  CODEX_PROFILE,
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
