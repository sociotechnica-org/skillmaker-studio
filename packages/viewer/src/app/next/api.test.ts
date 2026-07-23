import { describe, expect, test } from "bun:test";
import type { BundleDetailResponse, BundleStage, CatalogEntry, StateResponse, TodoRecord } from "../runtime/schemas.ts";
import { asWireStage, renderOrigin, STAGE_FROM_WIRE, toLoop, toProjects, toSkill, toTasks } from "./api.ts";
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
      awaitingReview: false,
    });
  });

  test("an awaiting-review substate turns on the attention-dot flag; absent stays off", () => {
    expect(toSkill(entry({ slug: "s", substate: "awaiting-review" })).awaitingReview).toBe(true);
    expect(toSkill(entry({ slug: "s", substate: "working" })).awaitingReview).toBe(false);
    expect(toSkill(entry({ slug: "s" })).awaitingReview).toBe(false);
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

// ---------------------------------------------------------------- toLoop

/** Minimal bundle-detail shape for the loop mapper -- only the fields toLoop reads. */
const detailFor = (overrides: {
  stage?: BundleStage;
  substate?: "working" | "awaiting-review";
  approvedForForward?: boolean;
  gateApproved?: boolean;
  events?: ReadonlyArray<{ type: string; at: string; payload: unknown }>;
}): BundleDetailResponse =>
  ({
    bundle: { slug: "to-tickets", stage: overrides.stage ?? "drafting", substate: overrides.substate ?? "working" },
    guardStatus: {
      stage: overrides.stage ?? "drafting",
      approvedForForward: overrides.approvedForForward ?? false,
      gateApproved: overrides.gateApproved ?? false,
    },
    events: (overrides.events ?? []).map((event, i) => ({
      id: `e${i}`,
      actor: { kind: "user", name: "test" },
      ...event,
    })),
  }) as unknown as BundleDetailResponse;

describe("asWireStage", () => {
  test("passes wire stages through and refuses anything else", () => {
    expect(asWireStage("drafting")).toBe("drafting");
    expect(asWireStage("published")).toBe("published");
    expect(asWireStage("Draft")).toBeUndefined();
    expect(asWireStage(undefined)).toBeUndefined();
  });
});

describe("toLoop", () => {
  test("carries the wire facts: slug, stage, substate, guard bits", () => {
    const loop = toLoop(detailFor({ stage: "researching", substate: "working", approvedForForward: true }));
    expect(loop.slug).toBe("to-tickets");
    expect(loop.stage).toBe("researching");
    expect(loop.substate).toBe("working");
    expect(loop.approvedForForward).toBe(true);
    expect(loop.pending).toBeUndefined();
    expect(loop.outcome).toBeUndefined();
  });

  test("a pending review is named for the REQUESTING state, never the current stage (#130)", () => {
    // Events as served: newest first. The stage moved on to evaluating,
    // but the request came from drafting -- the card must say drafting.
    const loop = toLoop(
      detailFor({
        stage: "evaluating",
        substate: "awaiting-review",
        events: [
          {
            type: "review.requested",
            at: "2026-07-22T10:00:00Z",
            payload: { bundle: "to-tickets", state: "drafting", artifacts: ["design.md"], question: "Ready?" },
          },
        ],
      }),
    );
    expect(loop.pending?.requestedState).toBe("drafting");
    expect(loop.pending?.artifacts).toEqual(["design.md"]);
    expect(loop.pending?.question).toBe("Ready?");
  });

  test("a resolved review on top of the request means nothing is pending, and the outcome surfaces", () => {
    const loop = toLoop(
      detailFor({
        stage: "drafting",
        substate: "working",
        events: [
          {
            type: "review.resolved",
            at: "2026-07-23T09:00:00Z",
            payload: { bundle: "to-tickets", state: "drafting", decision: "revise", notes: "tighten the triggers" },
          },
          {
            type: "review.requested",
            at: "2026-07-22T10:00:00Z",
            payload: { bundle: "to-tickets", state: "drafting" },
          },
        ],
      }),
    );
    expect(loop.pending).toBeUndefined();
    expect(loop.outcome).toEqual({ decision: "revise", at: "2026-07-23T09:00:00Z", notes: "tighten the triggers" });
  });

  test("an outcome for another stage's work does not leak into the current stage", () => {
    const loop = toLoop(
      detailFor({
        stage: "drafting",
        events: [
          {
            type: "review.resolved",
            at: "2026-07-21T09:00:00Z",
            payload: { bundle: "to-tickets", state: "researching", decision: "approve" },
          },
        ],
      }),
    );
    expect(loop.outcome).toBeUndefined();
  });
});
