import { describe, expect, test } from "bun:test";
import type { BundleStage, CatalogEntry, StateResponse, TodoRecord } from "../runtime/schemas.ts";
import { renderOrigin, STAGE_FROM_WIRE, toProjects, toSkill, toTasks } from "./api.ts";
import { STAGES } from "./types.ts";
import type { Stage } from "./types.ts";

const entry = (overrides: Partial<CatalogEntry> & { slug: string }): CatalogEntry => ({
  name: overrides.slug,
  oneLiner: "",
  tags: [],
  stage: "idea",
  archived: false,
  drift: "no-version",
  latestVersion: null,
  fixtureCount: 0,
  measuredFixtureCount: 0,
  openTodoCount: 0,
  unverified: false,
  lastShipment: null,
  lastActivityAt: "2026-01-01",
  ...overrides,
});

const state: StateResponse = {
  workspace: { path: "/home/me/skills", name: "skills" },
  config: { skillsDir: "skills", viewerPort: 4321, providers: [], publishTargets: [] },
};

const todo = (overrides: Partial<TodoRecord> & { id: string }): TodoRecord => ({
  kind: "task",
  status: "open",
  title: overrides.id,
  priority: 30,
  created: "2026-01-01",
  swept: false,
  source: { kind: "user", name: "viewer" },
  ...overrides,
});

describe("STAGE_FROM_WIRE", () => {
  test("maps every wire stage onto a display Stage from types.ts", () => {
    const cases: ReadonlyArray<[BundleStage, Stage]> = [
      ["idea", "Idea"],
      ["researching", "Research"],
      ["drafting", "Drafting"],
      ["evaluating", "Evals"],
      ["published", "Published"],
    ];
    for (const [wire, display] of cases) {
      expect(STAGE_FROM_WIRE[wire]).toBe(display);
      expect(STAGES).toContain(display);
    }
  });
});

describe("toSkill / toProjects", () => {
  test("catalog entry becomes a Skill with the display stage", () => {
    expect(toSkill(entry({ slug: "to-tickets", stage: "evaluating", oneLiner: "Decompose scope" }))).toEqual({
      slug: "to-tickets",
      stage: "Evals",
      oneLiner: "Decompose scope",
    });
  });

  test("a single project named from the workspace, archived entries excluded", () => {
    const projects = toProjects(state, [
      entry({ slug: "alpha", stage: "published" }),
      entry({ slug: "retired", archived: true }),
    ]);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("skills");
    expect(projects[0]?.path).toBe("/home/me/skills");
    expect(projects[0]?.skills.map((s) => s.slug)).toEqual(["alpha"]);
  });
});

describe("renderOrigin", () => {
  test("run origin renders as run · bundle", () => {
    expect(renderOrigin(todo({ id: "a", bundle: "to-tickets", origin: { kind: "run", runId: "r1" } }))).toBe(
      "run · to-tickets",
    );
  });

  test("field-report and intake origins render with their own prefixes", () => {
    expect(
      renderOrigin(todo({ id: "a", bundle: "to-tickets", origin: { kind: "field-report", eventId: "e1" } })),
    ).toBe("report · to-tickets");
    expect(renderOrigin(todo({ id: "b", origin: { kind: "intake", intakeId: "i1" } }))).toBe("intake");
  });

  test("origin-less eval todo is a coverage gap", () => {
    expect(renderOrigin(todo({ id: "a", kind: "eval", bundle: "to-tickets" }))).toBe("gap · to-tickets");
  });

  test("origin-less non-eval todo is human", () => {
    expect(renderOrigin(todo({ id: "a", bundle: "to-tickets" }))).toBe("human");
    expect(renderOrigin(todo({ id: "b" }))).toBe("human");
  });

  test("origin without a bundle renders bare", () => {
    expect(renderOrigin(todo({ id: "a", origin: { kind: "run", runId: "r1" } }))).toBe("run");
  });
});

describe("toTasks", () => {
  test("open and in-progress map through; terminal todos drop", () => {
    const tasks = toTasks([
      todo({ id: "open-one" }),
      todo({ id: "working", status: "in-progress" }),
      todo({ id: "finished", status: "done" }),
      todo({ id: "refused", status: "wont-do" }),
    ]);
    expect(tasks.map((t) => t.title)).toEqual(["open-one", "working"]);
    expect(tasks.map((t) => t.state)).toEqual(["open", "in-progress"]);
  });
});
