/**
 * Issue #190: chat agent homes must receive William from the product when a
 * user workspace does not carry the helpers itself.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { prepareAgentHome } from "../src/server/ChatSessions.ts";

const RESEARCH = "william-research-a-skill";
const DRAFT = "william-draft-skill-md";
const HELPERS = [RESEARCH, DRAFT] as const;

let root: string;
let workspace: string;
let packaged: string;
let homeBase: string;
let priorAgentHome: string | undefined;
let priorClaudeConfig: string | undefined;

const writeHelper = (
  base: string,
  slug: string,
  contents: string,
  layout: "output" | "root" = "output",
  extra?: Readonly<Record<string, string>>,
): void => {
  const dir = layout === "output" ? join(base, slug, "output") : join(base, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), contents);
  for (const [path, value] of Object.entries(extra ?? {})) {
    const target = join(dir, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, value);
  }
};

const agentSkill = (slug: string): string => join(homeBase, "claude-code", "skills", slug);

const tree = (dir: string): Readonly<Record<string, string>> => {
  const files: Record<string, string> = {};
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path)] = readFileSync(path, "utf8");
    }
  };
  walk(dir);
  return files;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "skillmaker-chat-home-"));
  workspace = join(root, "workspace");
  packaged = join(root, "packaged");
  homeBase = join(root, "agent-home");
  mkdirSync(join(workspace, "skills"), { recursive: true });
  mkdirSync(packaged, { recursive: true });
  priorAgentHome = process.env.SKILLMAKER_AGENT_HOME_DIR;
  priorClaudeConfig = process.env.CLAUDE_CONFIG_DIR;
  process.env.SKILLMAKER_AGENT_HOME_DIR = homeBase;
  process.env.CLAUDE_CONFIG_DIR = join(root, "empty-claude-config");
});

afterEach(() => {
  if (priorAgentHome === undefined) delete process.env.SKILLMAKER_AGENT_HOME_DIR;
  else process.env.SKILLMAKER_AGENT_HOME_DIR = priorAgentHome;
  if (priorClaudeConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = priorClaudeConfig;
  rmSync(root, { recursive: true, force: true });
});

describe("prepareAgentHome (#190)", () => {
  test("installs packaged helpers when the workspace carries neither", () => {
    writeHelper(packaged, RESEARCH, "packaged research", "output", { "references.md": "packaged reference" });
    writeHelper(packaged, DRAFT, "packaged draft");

    const prepared = prepareAgentHome("claude-code", workspace, "skills", () => packaged);

    expect(prepared.installedHelpers).toEqual([
      { slug: RESEARCH, source: "packaged" },
      { slug: DRAFT, source: "packaged" },
    ]);
    expect(readFileSync(join(agentSkill(RESEARCH), "SKILL.md"), "utf8")).toBe("packaged research");
    expect(readFileSync(join(agentSkill(RESEARCH), "references.md"), "utf8")).toBe("packaged reference");
    expect(existsSync(join(workspace, "skills", RESEARCH))).toBe(false);
    expect(existsSync(join(workspace, "skills", DRAFT))).toBe(false);
  });

  test("installs workspace helpers when packaged lookup is unavailable, including root-layout helpers", () => {
    writeHelper(join(workspace, "skills"), RESEARCH, "workspace research", "root");
    writeHelper(join(workspace, "skills"), DRAFT, "workspace draft");

    const prepared = prepareAgentHome("claude-code", workspace, "skills", () => undefined);

    expect(prepared.installedHelpers).toEqual([
      { slug: RESEARCH, source: "workspace" },
      { slug: DRAFT, source: "workspace" },
    ]);
    expect(readFileSync(join(agentSkill(RESEARCH), "SKILL.md"), "utf8")).toBe("workspace research");
    expect(readFileSync(join(agentSkill(DRAFT), "SKILL.md"), "utf8")).toBe("workspace draft");
  });

  test("resolves each helper independently and prefers output over a root SKILL.md", () => {
    writeHelper(join(workspace, "skills"), RESEARCH, "workspace root", "root");
    writeHelper(join(workspace, "skills"), RESEARCH, "workspace output");
    writeHelper(packaged, DRAFT, "packaged draft", "root");
    writeHelper(packaged, DRAFT, "packaged output");

    const prepared = prepareAgentHome("claude-code", workspace, "skills", () => packaged);

    expect(prepared.installedHelpers).toEqual([
      { slug: RESEARCH, source: "workspace" },
      { slug: DRAFT, source: "packaged" },
    ]);
    expect(readFileSync(join(agentSkill(RESEARCH), "SKILL.md"), "utf8")).toBe("workspace output");
    expect(readFileSync(join(agentSkill(DRAFT), "SKILL.md"), "utf8")).toBe("packaged output");
  });

  test("leaves an unresolved helper destination untouched", () => {
    writeHelper(agentSkill(RESEARCH), ".", "old helper", "root", { "obsolete.md": "keep me" });

    const prepared = prepareAgentHome("claude-code", workspace, "skills", () => undefined);

    expect(prepared.installedHelpers).toEqual([]);
    expect(tree(agentSkill(RESEARCH))).toEqual({ "SKILL.md": "old helper", "obsolete.md": "keep me" });
  });

  test("replaces stale destinations and is idempotent without output nesting", () => {
    writeHelper(packaged, RESEARCH, "new research", "output", { "new.md": "new" });
    writeHelper(packaged, DRAFT, "new draft");
    writeHelper(agentSkill(RESEARCH), ".", "old research", "root", { "obsolete.md": "old" });

    const first = prepareAgentHome("claude-code", workspace, "skills", () => packaged);
    const firstTree = tree(join(homeBase, "claude-code", "skills"));
    const second = prepareAgentHome("claude-code", workspace, "skills", () => packaged);

    expect(first).toEqual(second);
    expect(tree(join(homeBase, "claude-code", "skills"))).toEqual(firstTree);
    expect(tree(agentSkill(RESEARCH))).toEqual({ "SKILL.md": "new research", "new.md": "new" });
    expect(existsSync(join(agentSkill(RESEARCH), "output"))).toBe(false);
  });
});
