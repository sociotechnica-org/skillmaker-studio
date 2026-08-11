/**
 * Machine-level settings.json (director ruling R9): the tolerant reader
 * (absent / unusable / parsed trichotomy, EvalsJson.ts's tolerance law) and
 * THE precedence rule (`resolveRunChoices`): explicit per-run choice >
 * machine settings default > built-in. Every test runs against a temp
 * "home" resolved through `machineHome({SKILLMAKER_STUDIO_HOME: ...})` --
 * nothing here ever touches the real `~/.skillmaker-studio`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineHome } from "../src/MachineConfig.ts";
import {
  DEFAULT_RUN_PROVIDER,
  machineSettingsPath,
  readMachineSettings,
  resolveRunChoices,
} from "../src/MachineSettings.ts";

let home: string;

beforeEach(() => {
  // The env-override home dir convention: tests address the machine home
  // exactly the way production code does, via SKILLMAKER_STUDIO_HOME.
  home = machineHome({ SKILLMAKER_STUDIO_HOME: mkdtempSync(join(tmpdir(), "skillmaker-machine-settings-")) });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const write = (content: string): void => {
  writeFileSync(machineSettingsPath(home), content);
};

describe("readMachineSettings", () => {
  test("absent file: status absent, no warnings, no defaults (current behavior exactly)", () => {
    const result = readMachineSettings(home);
    expect(result.status).toBe("absent");
    expect(result.defaults).toEqual({});
    expect(result.warnings).toHaveLength(0);
  });

  test("malformed JSON: unusable, warned, never thrown", () => {
    write("{nope");
    const result = readMachineSettings(home);
    expect(result.status).toBe("unusable");
    expect(result.defaults).toEqual({});
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("not valid JSON");
  });

  test("non-object top level (array) is unusable, warned", () => {
    write("[1,2,3]");
    const result = readMachineSettings(home);
    expect(result.status).toBe("unusable");
    expect(result.warnings[0]).toContain("top level is not an object");
  });

  test("well-formed file parses all three defaults", () => {
    write(
      JSON.stringify({
        schemaVersion: 1,
        defaults: { provider: "codex", model: "gpt-5-codex", runTimeoutSeconds: 600 },
      }),
    );
    const result = readMachineSettings(home);
    expect(result.status).toBe("parsed");
    expect(result.warnings).toHaveLength(0);
    expect(result.defaults).toEqual({ provider: "codex", model: "gpt-5-codex", runTimeoutSeconds: 600 });
  });

  test("partial defaults are fine; omitted fields stay absent", () => {
    write(JSON.stringify({ schemaVersion: 1, defaults: { runTimeoutSeconds: 90 } }));
    const result = readMachineSettings(home);
    expect(result.status).toBe("parsed");
    expect(result.defaults).toEqual({ runTimeoutSeconds: 90 });
    expect(result.warnings).toHaveLength(0);
  });

  test("missing defaults object is parsed with no defaults, no warning", () => {
    write(JSON.stringify({ schemaVersion: 1 }));
    const result = readMachineSettings(home);
    expect(result.status).toBe("parsed");
    expect(result.defaults).toEqual({});
    expect(result.warnings).toHaveLength(0);
  });

  test("non-object defaults degrades to built-ins with a warning", () => {
    write(JSON.stringify({ schemaVersion: 1, defaults: "claude-code" }));
    const result = readMachineSettings(home);
    expect(result.status).toBe("parsed");
    expect(result.defaults).toEqual({});
    expect(result.warnings[0]).toContain('"defaults" is not an object');
  });

  test("defective fields are skipped individually, surviving fields kept", () => {
    write(
      JSON.stringify({
        schemaVersion: 1,
        defaults: { provider: 42, model: "  opus  ", runTimeoutSeconds: -5 },
      }),
    );
    const result = readMachineSettings(home);
    expect(result.status).toBe("parsed");
    expect(result.defaults).toEqual({ model: "opus" });
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join("\n")).toContain("defaults.provider");
    expect(result.warnings.join("\n")).toContain("defaults.runTimeoutSeconds");
  });

  test("empty-string and null values are ignored with warnings", () => {
    write('{"defaults": {"provider": "", "runTimeoutSeconds": null}}');
    const result = readMachineSettings(home);
    expect(result.status).toBe("parsed");
    expect(result.defaults).toEqual({});
    expect(result.warnings).toHaveLength(2);
  });

  test("unknown keys pass through silently (tolerant schema)", () => {
    write(
      JSON.stringify({
        schemaVersion: 1,
        futureTopLevelThing: { a: 1 },
        defaults: { provider: "claude-code", harness: "claude-code", futureKey: true },
      }),
    );
    const result = readMachineSettings(home);
    expect(result.status).toBe("parsed");
    expect(result.defaults).toEqual({ provider: "claude-code" });
    expect(result.warnings).toHaveLength(0);
  });

  test("unexpected schemaVersion warns but still reads tolerantly", () => {
    write(JSON.stringify({ schemaVersion: 2, defaults: { provider: "codex" } }));
    const result = readMachineSettings(home);
    expect(result.status).toBe("parsed");
    expect(result.defaults).toEqual({ provider: "codex" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("schemaVersion");
  });
});

describe("resolveRunChoices (precedence: explicit > machine > built-in)", () => {
  const machine = { provider: "codex", model: "gpt-5-codex", runTimeoutSeconds: 600 };

  test("no machine defaults, no explicit choices: built-ins exactly", () => {
    const choices = resolveRunChoices({}, {});
    expect(choices).toEqual({ provider: DEFAULT_RUN_PROVIDER });
    expect(choices.model).toBeUndefined();
    expect(choices.timeoutMs).toBeUndefined();
  });

  test("machine defaults fill in when nothing explicit was chosen", () => {
    expect(resolveRunChoices(machine, {})).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
      timeoutMs: 600_000,
    });
  });

  test("explicit per-run choices always win over machine defaults", () => {
    expect(resolveRunChoices(machine, { provider: "claude-code", model: "opus", timeoutMs: 30_000 })).toEqual({
      provider: "claude-code",
      model: "opus",
      timeoutMs: 30_000,
    });
  });

  test("precedence is per-field: explicit timeout, machine provider/model", () => {
    expect(resolveRunChoices(machine, { timeoutMs: 45_000 })).toEqual({
      provider: "codex",
      model: "gpt-5-codex",
      timeoutMs: 45_000,
    });
  });

  test("partial machine defaults leave the rest on built-ins", () => {
    const choices = resolveRunChoices({ runTimeoutSeconds: 90 }, {});
    expect(choices).toEqual({ provider: DEFAULT_RUN_PROVIDER, timeoutMs: 90_000 });
  });

  test("fractional runTimeoutSeconds rounds to whole milliseconds", () => {
    expect(resolveRunChoices({ runTimeoutSeconds: 1.5 }, {}).timeoutMs).toBe(1500);
  });
});

describe("end to end through the env-override home", () => {
  test("a present file's defaults resolve against explicit flags exactly like a dispatch door", () => {
    write(JSON.stringify({ schemaVersion: 1, defaults: { provider: "codex", runTimeoutSeconds: 120 } }));
    const settings = readMachineSettings(home);
    expect(settings.status).toBe("parsed");
    // Door behavior: only --model given explicitly.
    const choices = resolveRunChoices(settings.defaults, { model: "gpt-5-codex" });
    expect(choices).toEqual({ provider: "codex", model: "gpt-5-codex", timeoutMs: 120_000 });
  });
});
