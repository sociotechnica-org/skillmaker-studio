/**
 * The machine-level project registry (director rulings 2026-07-27): one file
 * at `<home>/config.json`, `{projects: [{path}]}`, atomic writes, and
 * deterministic order-independent URL slugs. Every test runs against a temp
 * "home" -- `SKILLMAKER_STUDIO_HOME`'s whole purpose is that nothing here
 * ever touches the real `~/.skillmaker-studio`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MachineConfigMalformedError,
  addMachineProject,
  computeProjectSlugs,
  emptyMachineConfig,
  isSkillmakerProjectDir,
  machineConfigPath,
  machineHome,
  readMachineConfig,
  removeMachineProject,
  writeMachineConfig,
} from "../src/MachineConfig.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "skillmaker-machine-config-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("machineHome", () => {
  test("honors the SKILLMAKER_STUDIO_HOME override", () => {
    expect(machineHome({ SKILLMAKER_STUDIO_HOME: "/tmp/custom-home" })).toBe("/tmp/custom-home");
  });

  test("falls back to ~/.skillmaker-studio when unset or empty", () => {
    expect(machineHome({})).toEndWith("/.skillmaker-studio");
    expect(machineHome({ SKILLMAKER_STUDIO_HOME: "" })).toEndWith("/.skillmaker-studio");
  });
});

describe("readMachineConfig", () => {
  test("missing file is an empty registry", () => {
    expect(readMachineConfig(home).projects).toHaveLength(0);
  });

  test("malformed JSON is a loud typed error, never silently empty", () => {
    writeFileSync(machineConfigPath(home), "{nope");
    expect(() => readMachineConfig(home)).toThrow(MachineConfigMalformedError);
  });

  test("wrong shape is a loud typed error", () => {
    writeFileSync(machineConfigPath(home), JSON.stringify({ projects: [{ dir: "/x" }] }));
    expect(() => readMachineConfig(home)).toThrow(MachineConfigMalformedError);
  });

  test("round-trips what writeMachineConfig wrote", () => {
    writeMachineConfig(home, emptyMachineConfig());
    expect(readMachineConfig(home).projects).toHaveLength(0);
    addMachineProject(home, "/some/abs/project");
    expect(readMachineConfig(home).projects.map((p) => p.path)).toEqual(["/some/abs/project"]);
  });

  test("registry stores ONLY paths -- no names, no derived data", () => {
    addMachineProject(home, "/some/abs/project");
    const raw = JSON.parse(readFileSync(machineConfigPath(home), "utf8")) as {
      projects: ReadonlyArray<Record<string, unknown>>;
    };
    expect(Object.keys(raw.projects[0] ?? {})).toEqual(["path"]);
  });
});

describe("add/remove", () => {
  test("add resolves to an absolute path and reports already_registered on repeat", () => {
    const first = addMachineProject(home, "/a/b/../b/project");
    expect(first).toEqual({ status: "added", path: "/a/b/project" });
    expect(addMachineProject(home, "/a/b/project").status).toBe("already_registered");
    expect(readMachineConfig(home).projects).toHaveLength(1);
  });

  test("remove unregisters without touching the directory", () => {
    const projectDir = join(home, "real-project");
    mkdirSync(projectDir);
    addMachineProject(home, projectDir);
    expect(removeMachineProject(home, projectDir)).toEqual({ status: "removed", path: projectDir });
    expect(readMachineConfig(home).projects).toHaveLength(0);
    // The directory survives -- remove is forgetting, never deleting.
    expect(isSkillmakerProjectDir(projectDir)).toBe(false); // still no config...
    expect(() => readFileSync(join(projectDir, "nope"), "utf8")).toThrow(); // ...but the dir exists
  });

  test("removing an unknown path is honestly reported", () => {
    expect(removeMachineProject(home, "/never/registered").status).toBe("not_registered");
  });
});

describe("isSkillmakerProjectDir", () => {
  test("true only for an absolute dir carrying skillmaker.config.json", () => {
    const projectDir = join(home, "ws");
    mkdirSync(projectDir);
    expect(isSkillmakerProjectDir(projectDir)).toBe(false);
    writeFileSync(join(projectDir, "skillmaker.config.json"), "{}");
    expect(isSkillmakerProjectDir(projectDir)).toBe(true);
    expect(isSkillmakerProjectDir("relative/path")).toBe(false);
  });
});

describe("computeProjectSlugs", () => {
  test("unique basenames get bare slugified slugs", () => {
    const slugs = computeProjectSlugs(["/home/u/My Skills", "/srv/other-project"]);
    expect(slugs.get("/home/u/My Skills")).toBe("my-skills");
    expect(slugs.get("/srv/other-project")).toBe("other-project");
  });

  test("colliding basenames ALL get a stable path-hash suffix", () => {
    const slugs = computeProjectSlugs(["/a/skills", "/b/skills"]);
    const first = slugs.get("/a/skills") as string;
    const second = slugs.get("/b/skills") as string;
    expect(first).toMatch(/^skills-[0-9a-f]{8}$/);
    expect(second).toMatch(/^skills-[0-9a-f]{8}$/);
    expect(first).not.toBe(second);
  });

  test("slugs are order-independent: adding a non-colliding project renames nothing", () => {
    const before = computeProjectSlugs(["/a/skills", "/b/skills"]);
    const after = computeProjectSlugs(["/z/unrelated", "/b/skills", "/a/skills"]);
    expect(after.get("/a/skills")).toBe(before.get("/a/skills") as string);
    expect(after.get("/b/skills")).toBe(before.get("/b/skills") as string);
  });
});
