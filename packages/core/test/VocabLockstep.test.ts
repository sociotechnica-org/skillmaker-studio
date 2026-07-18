/**
 * The vocab lockstep test: the viewer deliberately never imports core (it
 * decodes what the wire actually sends), so ~a dozen enums and label tables
 * are hand-mirrored in `packages/viewer/src/app/runtime/schemas.ts` (and
 * `STAGE_LABEL` a third time in `packages/cli/src/StageVocab.ts`). That
 * boundary is load-bearing and stays; what must not stay is SILENT drift
 * between the mirrors. This file imports both sides and asserts
 * value-for-value equality, so a vocabulary change on one side fails CI
 * with a message naming the other.
 *
 * Deliberately asserts CONSISTENCY between mirrors, not specific words --
 * display labels are expected to change (they are the rename layer); the
 * stored literals are frozen vocabulary and the mirrors must always agree
 * on both.
 *
 * Also the executable home of ruled policy invariants that would otherwise
 * live only in doc comments: every verdict offers a non-empty door list
 * that includes `salvage` (the universal refusal door), and the
 * identity-granting dispositions are exactly the dispositions minus
 * `salvage`.
 */
import { describe, expect, test } from "bun:test";
import { STAGE_LABEL as CLI_STAGE_LABEL } from "../../cli/src/StageVocab.ts";
import { SMOKE_K as VIEWER_SMOKE_K } from "../../viewer/src/app/runtime/cardGlance.ts";
import * as viewer from "../../viewer/src/app/runtime/schemas.ts";
import {
  FieldReportOutcome,
  IntakeRights,
  IntakeStakes,
  RouteDisposition,
  RunVerdict,
} from "../src/Journal.ts";
import { SMOKE_K } from "../src/Measurements.ts";
import { DOSSIER_SECTIONS } from "../src/Dossier.ts";
import { CARD_FIELDS, TRIAGE_STAKES_VALUES } from "../src/Triage.ts";
import { STAGES } from "../src/Machine.ts";
import { VERDICT_DISPOSITIONS } from "../src/Receive.ts";
import { DISPOSITIONS } from "../src/Route.ts";
import { IDENTITY_GRANTING_DISPOSITIONS } from "../src/Verification.ts";

/** Effect `Schema.Literals(...)` exposes its members as `.literals`. */
const literalsOf = (schema: { readonly literals: ReadonlyArray<unknown> }): ReadonlyArray<unknown> => [
  ...schema.literals,
];

const asSet = (values: ReadonlyArray<unknown>): ReadonlyArray<unknown> => [...values].sort();

describe("core <-> viewer mirrors", () => {
  test("stage ladder: same values, same order", () => {
    expect([...viewer.STAGES]).toEqual([...STAGES]);
    expect(literalsOf(viewer.BundleStage)).toEqual([...STAGES]);
  });

  test("route dispositions: journal schema, Route's list, and the viewer agree", () => {
    expect(literalsOf(viewer.RouteDisposition)).toEqual(literalsOf(RouteDisposition));
    expect([...DISPOSITIONS] as ReadonlyArray<unknown>).toEqual(literalsOf(RouteDisposition));
  });

  test("field-report outcomes agree", () => {
    expect(literalsOf(viewer.FieldReportOutcome)).toEqual(literalsOf(FieldReportOutcome));
  });

  test("intake rights agree", () => {
    expect(literalsOf(viewer.IntakeRights)).toEqual(literalsOf(IntakeRights));
  });

  test("intake stakes agree (issue #108) -- and Triage's derived list matches the one canonical schema", () => {
    expect(literalsOf(viewer.IntakeStakes)).toEqual(literalsOf(IntakeStakes));
    expect([...TRIAGE_STAKES_VALUES] as ReadonlyArray<unknown>).toEqual(literalsOf(IntakeStakes));
  });

  test("run verdicts agree", () => {
    expect(literalsOf(viewer.RunVerdict)).toEqual(literalsOf(RunVerdict));
  });

  test("intake verdicts agree (viewer literals vs the door table's keys)", () => {
    expect(asSet(literalsOf(viewer.IntakeVerdict))).toEqual(asSet(Object.keys(VERDICT_DISPOSITIONS)));
  });

  test("verdict->doors table agrees, entry for entry", () => {
    expect(viewer.VERDICT_DISPOSITIONS).toEqual(VERDICT_DISPOSITIONS);
  });
});

describe("core <-> viewer numeric mirrors", () => {
  test("SMOKE_K: the card's below-smoke chip threshold equals core's guidance constant (issue #109)", () => {
    expect(VIEWER_SMOKE_K).toBe(SMOKE_K);
  });
});

describe("cli <-> viewer label tables", () => {
  test("STAGE_LABEL: same keys, same display words", () => {
    expect(CLI_STAGE_LABEL).toEqual(viewer.STAGE_LABEL);
  });
});

describe("ruled policy invariants", () => {
  test("every verdict offers at least one door, and salvage is always among them", () => {
    for (const [verdict, offered] of Object.entries(VERDICT_DISPOSITIONS)) {
      expect(offered.length, `verdict "${verdict}" offers no doors`).toBeGreaterThan(0);
      expect(offered, `verdict "${verdict}" must offer the refusal door`).toContain("salvage");
    }
  });

  test("every offered door is a real disposition", () => {
    for (const offered of Object.values(VERDICT_DISPOSITIONS)) {
      for (const door of offered) {
        expect(DISPOSITIONS).toContain(door);
      }
    }
  });

  test("identity-granting dispositions are exactly the dispositions minus salvage", () => {
    expect(asSet(IDENTITY_GRANTING_DISPOSITIONS)).toEqual(
      asSet(DISPOSITIONS.filter((disposition) => disposition !== "salvage")),
    );
  });

  test("card-field triad (issue #108, seam pass): every CARD_FIELDS label is a dossier section, keys are distinct", () => {
    // Labels are `DossierSectionName` at the type level already; this holds
    // the runtime values in lockstep too, so a rename that dodges the type
    // (e.g. a widened cast) still fails loudly here.
    for (const [label] of CARD_FIELDS) {
      expect(DOSSIER_SECTIONS as ReadonlyArray<string>).toContain(label);
    }
    const keys = CARD_FIELDS.map(([, key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    const labels = CARD_FIELDS.map(([label]) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
