import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareAgentHome } from "../src/server/ChatSessions.ts";

const HELPERS = ["william-research-a-skill", "william-draft-skill-md"] as const;

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const withScratch = (
  run: (paths: { readonly workspace: string; readonly packaged: string; readonly agentHome: string }) => void,
): void => {
  const root = mkdtempSync(join(tmpdir(), "skillmaker-chat-agent-home-"));
  const workspace = join(root, "workspace");
  const packaged = join(root, "packaged");
  const agentHome = join(root, "agent-home");
  const authHome = join(root, "codex-home");
  const previousAgentHome = process.env.SKILLMAKER_AGENT_HOME_DIR;
  const previousCodexHome = process.env.CODEX_HOME;
  mkdirSync(authHome, { recursive: true });
  process.env.SKILLMAKER_AGENT_HOME_DIR = agentHome;
  process.env.CODEX_HOME = authHome;
  cleanup = () => {
    if (previousAgentHome === undefined) delete process.env.SKILLMAKER_AGENT_HOME_DIR;
    else process.env.SKILLMAKER_AGENT_HOME_DIR = previousAgentHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    rmSync(root, { recursive: true, force: true });
  };
  run({ workspace, packaged, agentHome });
};

const writeHelper = (root: string, slug: string, content: string, layout: "output" | "root"): void => {
  const dir = layout === "output" ? join(root, slug, "output") : join(root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
};

const installedSkill = (agentHome: string, slug: string): string =>
  join(agentHome, "codex", "skills", slug, "SKILL.md");

describe("prepareAgentHome helper installation", () => {
  test("installs packaged-only helpers without writing them into the workspace", () => {
    withScratch(({ workspace, packaged, agentHome }) => {
      writeHelper(packaged, HELPERS[0], "packaged output\n", "output");
      writeHelper(packaged, HELPERS[1], "packaged root\n", "root");

      const result = prepareAgentHome("codex", workspace, "skills", { packagedSkillsDir: packaged });

      expect(result.installedHelpers).toEqual([
        { slug: HELPERS[0], source: "packaged" },
        { slug: HELPERS[1], source: "packaged" },
      ]);
      expect(readFileSync(installedSkill(agentHome, HELPERS[0]), "utf8")).toBe("packaged output\n");
      expect(readFileSync(installedSkill(agentHome, HELPERS[1]), "utf8")).toBe("packaged root\n");
      expect(existsSync(join(workspace, "skills", HELPERS[0]))).toBe(false);
      expect(existsSync(join(workspace, "skills", HELPERS[1]))).toBe(false);
    });
  });

  test("workspace helpers win over packaged copies in both supported layouts", () => {
    withScratch(({ workspace, packaged, agentHome }) => {
      const workspaceSkills = join(workspace, "skills");
      writeHelper(workspaceSkills, HELPERS[0], "workspace output\n", "output");
      writeHelper(workspaceSkills, HELPERS[1], "workspace root\n", "root");
      writeHelper(packaged, HELPERS[0], "packaged root\n", "root");
      writeHelper(packaged, HELPERS[1], "packaged output\n", "output");

      const result = prepareAgentHome("codex", workspace, "skills", { packagedSkillsDir: packaged });

      expect(result.installedHelpers).toEqual([
        { slug: HELPERS[0], source: "workspace" },
        { slug: HELPERS[1], source: "workspace" },
      ]);
      expect(readFileSync(installedSkill(agentHome, HELPERS[0]), "utf8")).toBe("workspace output\n");
      expect(readFileSync(installedSkill(agentHome, HELPERS[1]), "utf8")).toBe("workspace root\n");
    });
  });

  test("resolves each helper independently across workspace and packaged sources", () => {
    withScratch(({ workspace, packaged, agentHome }) => {
      writeHelper(join(workspace, "skills"), HELPERS[0], "workspace\n", "output");
      writeHelper(packaged, HELPERS[1], "packaged\n", "output");

      const result = prepareAgentHome("codex", workspace, "skills", { packagedSkillsDir: packaged });

      expect(result.installedHelpers).toEqual([
        { slug: HELPERS[0], source: "workspace" },
        { slug: HELPERS[1], source: "packaged" },
      ]);
      expect(readFileSync(installedSkill(agentHome, HELPERS[0]), "utf8")).toBe("workspace\n");
      expect(readFileSync(installedSkill(agentHome, HELPERS[1]), "utf8")).toBe("packaged\n");
    });
  });

  test("leaves unresolved pre-existing helpers untouched", () => {
    withScratch(({ workspace, agentHome }) => {
      const destination = join(agentHome, "codex", "skills", HELPERS[0]);
      mkdirSync(join(destination, "nested"), { recursive: true });
      writeFileSync(join(destination, "SKILL.md"), "edited\n");
      writeFileSync(join(destination, "nested", "keep.md"), "keep\n");

      const result = prepareAgentHome("codex", workspace, "skills", { packagedSkillsDir: undefined });

      expect(result.installedHelpers).toEqual([]);
      expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("edited\n");
      expect(readFileSync(join(destination, "nested", "keep.md"), "utf8")).toBe("keep\n");
    });
  });

  test("is idempotent and never nests an output directory", () => {
    withScratch(({ workspace, packaged, agentHome }) => {
      writeHelper(join(workspace, "skills"), HELPERS[0], "workspace\n", "output");
      writeHelper(packaged, HELPERS[1], "packaged\n", "root");

      const first = prepareAgentHome("codex", workspace, "skills", { packagedSkillsDir: packaged });
      const second = prepareAgentHome("codex", workspace, "skills", { packagedSkillsDir: packaged });

      expect(second).toEqual(first);
      expect(existsSync(join(agentHome, "codex", "skills", HELPERS[0], "output"))).toBe(false);
      expect(existsSync(join(agentHome, "codex", "skills", HELPERS[1], "output"))).toBe(false);
    });
  });

  test("replaces a stale destination completely when a helper resolves", () => {
    withScratch(({ workspace, packaged, agentHome }) => {
      writeHelper(packaged, HELPERS[0], "new source\n", "output");
      const destination = join(agentHome, "codex", "skills", HELPERS[0]);
      mkdirSync(join(destination, "obsolete"), { recursive: true });
      writeFileSync(join(destination, "SKILL.md"), "old source\n");
      writeFileSync(join(destination, "obsolete", "old.md"), "old\n");

      prepareAgentHome("codex", workspace, "skills", { packagedSkillsDir: packaged });

      expect(readFileSync(join(destination, "SKILL.md"), "utf8")).toBe("new source\n");
      expect(existsSync(join(destination, "obsolete"))).toBe(false);
    });
  });
});
