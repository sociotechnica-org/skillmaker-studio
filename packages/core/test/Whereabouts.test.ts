/**
 * Whereabouts (issue #109): the derived status-set folds behind Track's
 * Catalog -- last shipment per bundle (latest wins) and recency of activity
 * (any attributable event re-stamps it). Pure, recomputable, never stored.
 */
import { describe, expect, test } from "bun:test";
import { Actor } from "../src/Actor.ts";
import type { JournalEvent } from "../src/Journal.ts";
import { foldLastActivityAt, foldLastShipments } from "../src/Whereabouts.ts";

const actor = Actor.make({ kind: "user", name: "test-user" });

let counter = 0;
const envelope = <T extends string>(type: T) => {
  counter += 1;
  return {
    schemaVersion: 1 as const,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    at: new Date(2026, 6, 10, 0, 0, counter).toISOString(),
    actor,
    type,
  };
};

const shipped = (bundle: string, destination: string): JournalEvent =>
  ({
    ...envelope("skill.shipped"),
    payload: { bundle, versionHash: "sha256:aa", destination, purpose: "x", receipts: [] },
  }) as JournalEvent;

describe("foldLastShipments", () => {
  test("empty journal -> empty map (never shipped is an honest absence)", () => {
    expect(foldLastShipments([]).size).toBe(0);
  });

  test("the latest shipment per bundle wins; other bundles stay independent", () => {
    const first = shipped("demo", "acme");
    const second = shipped("demo", "globex");
    const other = shipped("other", "initech");
    const shipments = foldLastShipments([first, second, other]);
    expect(shipments.get("demo")).toEqual({
      destination: "globex",
      versionHash: "sha256:aa",
      at: second.at,
    });
    expect(shipments.get("other")?.destination).toBe("initech");
  });

  test("non-shipment events never register", () => {
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } } as JournalEvent;
    expect(foldLastShipments([created]).size).toBe(0);
  });
});

describe("foldLastActivityAt", () => {
  test("any attributable event re-stamps the bundle's recency", () => {
    const created = { ...envelope("bundle.created"), payload: { bundle: "demo" } } as JournalEvent;
    const report = {
      ...envelope("skill.field_report"),
      payload: { bundle: "demo", outcome: "worked", report: "fine" },
    } as JournalEvent;
    const activity = foldLastActivityAt([created, report]);
    expect(activity.get("demo")).toBe(report.at);
  });

  test("unattributable events (a target-less salvage, skill.received) stamp nobody", () => {
    const received = {
      ...envelope("skill.received"),
      payload: { intake: "in-1", source: "somewhere" },
    } as JournalEvent;
    const salvaged = {
      ...envelope("skill.routed"),
      payload: { intake: "in-1", disposition: "salvage", reason: "broken" },
    } as JournalEvent;
    expect(foldLastActivityAt([received, salvaged]).size).toBe(0);
  });
});
