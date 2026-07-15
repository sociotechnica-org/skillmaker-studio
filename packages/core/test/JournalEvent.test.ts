import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { Actor } from "../src/Actor.ts";
import { JournalEvent, RunVerdict, GradedCheck } from "../src/Journal.ts";
import { RunRecord } from "../src/Run.ts";
import { Todo, TodoPatch } from "../src/Todo.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });
const agentActor = Actor.make({ kind: "agent", name: "william", provider: "claude-code" });

const envelope = (type: string) => ({
  schemaVersion: 1 as const,
  id: crypto.randomUUID(),
  at: new Date().toISOString(),
  actor,
  type,
});

const run = RunRecord.make({
  schemaVersion: 1,
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  bundle: "demo",
  kind: "eval",
  station: null,
  fixtureCase: "case-1",
  skillVersionHash: "sha256:abc",
  provider: "claude-code",
  model: "claude-sonnet-5",
  startedAt: new Date().toISOString(),
  status: "running",
  actor,
});

const todo = Todo.make({
  id: "td-01ARZ3NDEKTSV4RRFFQ69G5FAV",
  kind: "task",
  status: "open",
  title: "Write the design doc",
  priority: 30,
  created: new Date().toISOString(),
  source: actor,
});

/**
 * One representative payload per event type in the v1 catalog
 * (data-model.md §2.9) — round-tripped through JournalEvent to prove the
 * union decodes and re-encodes every member.
 */
const samples: ReadonlyArray<Record<string, unknown>> = [
  { ...envelope("bundle.created"), payload: { bundle: "demo" } },
  {
    ...envelope("bundle.stage_changed"),
    payload: { bundle: "demo", from: "idea", to: "researching" },
  },
  {
    ...envelope("bundle.gate_decided"),
    payload: { bundle: "demo", gate: "publish", decision: "approved", basis: "evals pass" },
  },
  { ...envelope("bundle.archived"), payload: { bundle: "demo" } },
  { ...envelope("bundle.restored"), payload: { bundle: "demo" } },
  {
    ...envelope("skill.version_recorded"),
    payload: { bundle: "demo", hash: "sha256:aaa", designHash: "sha256:bbb" },
  },
  {
    ...envelope("skill.published"),
    payload: { bundle: "demo", versionHash: "sha256:aaa", target: "claude-code" },
  },
  {
    ...envelope("skill.shipped"),
    payload: {
      bundle: "demo",
      versionHash: "sha256:aaa",
      destination: "acme-agent-fleet",
      purpose: "eval harness for team X",
      receipts: [
        {
          fixtureCase: "golden-basic",
          provider: "claude-code",
          model: "claude-sonnet-5",
          n: 30,
          passes: 29,
          passRate: 29 / 30,
          ci: [0.85, 0.99],
        },
      ],
    },
  },
  {
    ...envelope("skill.field_report"),
    payload: {
      bundle: "demo",
      outcome: "worked",
      report: "Ran fine against three prod repos this week.",
      versionHash: "sha256:aaa",
      destination: "acme-agent-fleet",
    },
  },
  { ...envelope("todo.opened"), payload: { todo } },
  {
    ...envelope("todo.updated"),
    payload: { id: todo.id, patch: TodoPatch.make({ title: "Renamed" }) },
  },
  {
    ...envelope("todo.status_changed"),
    payload: { id: todo.id, from: "open", to: "in-progress" },
  },
  { ...envelope("run.started"), payload: { run } },
  {
    ...envelope("run.completed"),
    payload: { id: run.id, status: "completed", endedAt: new Date().toISOString() },
  },
  {
    ...envelope("run.graded"),
    payload: {
      id: run.id,
      verdict: "pass" satisfies RunVerdict,
      checks: [GradedCheck.make({ text: "produces valid output", pass: true })],
    },
  },
  {
    ...envelope("station.started"),
    actor: agentActor,
    payload: { bundle: "demo", state: "researching", runId: run.id },
  },
  {
    ...envelope("review.requested"),
    actor: agentActor,
    payload: { bundle: "demo", state: "researching", artifacts: ["research/notes.md"] },
  },
  {
    ...envelope("review.resolved"),
    payload: { bundle: "demo", state: "researching", decision: "approve" },
  },
];

describe("JournalEvent schema round-trip", () => {
  for (const sample of samples) {
    const expectedType = sample.type;
    test(`decodes and re-encodes ${String(expectedType)}`, async () => {
      const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(JournalEvent)(sample));
      expect(String(decoded.type)).toBe(String(expectedType));

      const encoded = await Effect.runPromise(Schema.encodeEffect(JournalEvent)(decoded));
      const redecoded = await Effect.runPromise(Schema.decodeUnknownEffect(JournalEvent)(encoded));
      expect(String(redecoded.type)).toBe(String(expectedType));
    });
  }

  test("skill.field_report decodes with versionHash/destination omitted (issue #67: the reporter may not know either)", async () => {
    const sample = {
      ...envelope("skill.field_report"),
      payload: { bundle: "demo", outcome: "surprise", report: "Worked, but used a tool we didn't expect." },
    };
    const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(JournalEvent)(sample));
    expect(decoded.type).toBe("skill.field_report");
  });

  test("skill.field_report rejects an outcome outside worked/failed/surprise", async () => {
    const bad = {
      ...envelope("skill.field_report"),
      payload: { bundle: "demo", outcome: "mixed", report: "..." },
    };
    const outcome = await Effect.runPromiseExit(Schema.decodeUnknownEffect(JournalEvent)(bad));
    expect(outcome._tag).toBe("Failure");
  });

  test("rejects an unknown event type", async () => {
    const bad = { ...envelope("bundle.teleported"), payload: {} };
    const outcome = await Effect.runPromiseExit(Schema.decodeUnknownEffect(JournalEvent)(bad));
    expect(outcome._tag).toBe("Failure");
  });
});
