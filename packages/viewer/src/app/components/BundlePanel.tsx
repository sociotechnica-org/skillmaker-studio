/**
 * The bundle-detail page (`/bundles/:slug` + its sub-routes, ui-pass-spec.md
 * §3.1/§3.3): promoted from a 24rem side panel to a full page so Overview /
 * Files / Versions / Evals have room to breathe, and so a bundle is
 * linkable/bookmarkable. Four tabs, now real sub-routes instead of
 * `useState<PanelTab>` -- deep-linkable, refresh-safe, back/forward-safe by
 * construction (ui-pass-spec.md §3.4#2):
 *   - Overview: guard hints, the review pair (request/approve/revise), the
 *     publish flow, forward "advance", "move back", recent events. All
 *     writes go through `POST /api/events` (data-model.md §2.9/§2.13) via
 *     `runtime/api.ts`'s `postEvent`.
 *   - Files: read-only view of the bundle's reviewable sources (design.md +
 *     research/* + output/*, enumerated in the detail payload's `files`) via
 *     `GET /api/bundles/:slug/file` (a strict allowlist -- see Server.ts);
 *     `?file=` deep-links a specific one (the review panel's artifact links).
 *   - Versions: the drift badge (data-model.md §2.7), "Record version", and
 *     version history, via `GET /api/bundles/:slug` (versions + drift are
 *     already in the detail payload) and `POST /api/bundles/:slug/record-version`.
 *   - Evals: risk coverage + fixtures + runs; the run-detail modal's
 *     open/close state is synced to `?run=:runId` on this route (fixing the
 *     old Studio's worst focus-management flaw, ui-pass-spec.md §3.4#5).
 *
 * Reachable-409 choice (see task report): the "Advance" button stays
 * clickable even when `guardStatus` predicts a rejection -- it is only
 * styled as "not ready" and grows a one-line explanation -- rather than
 * being `disabled`. That keeps the guarded-transition 409 path reachable
 * from the UI itself (click when unapproved -> server rejects -> reason
 * shown inline), instead of requiring a separate dev-only affordance.
 */
import { type FC, useEffect, useState } from "react";
import {
  getBundleFile,
  type PostEventInput,
  postEvent,
  publishBundle,
  recordVersion,
  triggerRun,
  triggerStationRun,
} from "../runtime/api.ts";
import { bundleFileHref, bundleHref, bundleRunHref, Link, type BundleTab, useRouter } from "../runtime/router.tsx";
import {
  STAGES,
  STAGE_LABEL,
  type BundleStage,
  type CoverageValue,
  type Drift,
  type EventView,
  type FixtureRecord,
  type MeasurementRecord,
  type PublishTargetResult,
  type RiskCoverageRecord,
  type RunRecord,
  type VersionRecord,
  type WarningRecord,
} from "../runtime/schemas.ts";
import { useBundleDetail } from "../runtime/useBundleDetail.ts";
import { useWorkspace } from "../runtime/useWorkspace.ts";
import { nextAction, nextStageOf } from "../runtime/nextAction.ts";
import { RunDetailModal } from "./RunDetailModal.tsx";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (payload: unknown, key: string): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
};

const stringArrayField = (payload: unknown, key: string): ReadonlyArray<string> => {
  if (!isRecord(payload)) {
    return [];
  }
  const value = payload[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const earlierStages = (stage: BundleStage): ReadonlyArray<BundleStage> => STAGES.slice(0, STAGES.indexOf(stage));

/** A plain-language status line for the top of Overview -- replaces the raw stage/substate/guard-booleans dump. */
const statusLineFor = (stage: BundleStage, substate: string, forwardReady: boolean): string => {
  if (stage === "published") return "Published — this skill has shipped.";
  if (substate === "awaiting-review") return "Ready for your review.";
  if (stage === "evaluating") return "In evaluation — clear the publish gate to ship.";
  if (forwardReady) {
    const next = nextStageOf(stage);
    return next === undefined ? "Ready to move on." : `Approved — ready to move to ${STAGE_LABEL[next]}.`;
  }
  return `${STAGE_LABEL[stage]} — in progress.`;
};

/** Turn the machine's precise-but-internal guard rejections into a sentence a director can read. Anything unrecognized passes through. */
const humanizeError = (message: string): string => {
  if (message.includes("requires an approved review")) {
    return "This needs an approved review before it can move to the next stage.";
  }
  if (message.includes("publish gate")) {
    return "This needs the publish gate cleared before it can ship.";
  }
  if (message.includes("require a non-empty reason")) {
    return "Add a reason before moving it back to an earlier stage.";
  }
  return message;
};

const shortHash = (hash: string): string => {
  const prefix = "sha256:";
  if (!hash.startsWith(prefix)) {
    return hash;
  }
  const hex = hash.slice(prefix.length);
  return `${prefix}${hex.slice(0, 10)}`;
};

/**
 * Fix 4 (Phase 20 Story 2 friction log F6): prefer the human `label`
 * recorded via "Record version"; fall back to a short hex fragment (7-8
 * chars, no `"sha256:"` prefix) only when no label exists. Mirrors core's
 * `versionLabel` (Versions.ts) so the CLI table and this viewer never
 * disagree on the fallback rule.
 */
const versionLabelFor = (version: VersionRecord | undefined, hash: string): string => {
  if (version !== undefined && version.label !== undefined && version.label.length > 0) {
    return version.label;
  }
  const prefix = "sha256:";
  const hex = hash.startsWith(prefix) ? hash.slice(prefix.length) : hash;
  return hex.length > 8 ? hex.slice(0, 8) : hex;
};

const DRIFT_LABEL: Record<Drift, string> = {
  "no-version": "No version recorded",
  "in-sync": "In sync",
  "design-changed": "Design changed",
  "output-hand-edited": "Output hand-edited",
  both: "Design changed + output hand-edited",
};

const DRIFT_EXPLANATION: Record<Drift, string> = {
  "no-version": "This bundle has no recorded version yet -- record one to start tracking drift.",
  "in-sync": "design.md and output/ match the latest recorded version.",
  "design-changed": "design.md has changed since the latest recorded version; output/ still matches.",
  "output-hand-edited": "output/ has been hand-edited since the latest recorded version; design.md still matches.",
  both: "Both design.md and output/ have changed since the latest recorded version.",
};

const DRIFT_BADGE_CLASS: Record<Drift, string> = {
  "in-sync": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  "no-version": "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  "design-changed": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "output-hand-edited": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  both: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const TABS: ReadonlyArray<{ readonly key: BundleTab; readonly label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "files", label: "Files" },
  { key: "versions", label: "Versions" },
  { key: "evals", label: "Evals" },
];

/** IN Input / RE Reasoning / OUT Output / ADV Adversarial / CHN Chain (data-model.md §2.6). */
const RISK_FAMILY_ORDER = ["IN", "RE", "OUT", "ADV", "CHN"] as const;

const RISK_FAMILY_LABEL: Record<string, string> = {
  IN: "IN Input",
  RE: "RE Reasoning",
  OUT: "OUT Output",
  ADV: "ADV Adversarial",
  CHN: "CHN Chain",
};

const COVERAGE_GLYPH: Record<CoverageValue, string> = {
  covered: "●",
  partial: "◐",
  gap: "○",
  "n/a": "—",
};

const COVERAGE_LABEL: Record<CoverageValue, string> = {
  covered: "covered",
  partial: "partial",
  gap: "gap",
  "n/a": "n/a",
};

export const BundlePanel: FC<{
  slug: string;
  tab: BundleTab;
  runId: string | undefined;
  file: string | undefined;
}> = ({ slug, tab, runId, file }) => {
  const { detail, loading, error, refetch } = useBundleDetail(slug);
  const { navigate } = useRouter();
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [reviseNotes, setReviseNotes] = useState("");
  const [reviewQuestion, setReviewQuestion] = useState("");
  const [backTarget, setBackTarget] = useState("");
  const [backReason, setBackReason] = useState("");
  const [gateBasis, setGateBasis] = useState("");

  // Post a sequence of events in order, stopping at the first failure -- the
  // same collapse `PublishSection` uses for gate+advance, generalized so one
  // guided click can e.g. approve-then-advance. A partial failure leaves a
  // legal intermediate state the panel re-renders the next step from.
  const submitMany = (events: ReadonlyArray<PostEventInput>): void => {
    setPending(true);
    setActionError(undefined);
    void (async () => {
      for (const event of events) {
        const result = await postEvent(event);
        if (!result.ok) {
          setActionError(result.error);
          return;
        }
      }
      setActionError(undefined);
      refetch();
    })()
      .catch((cause: Error) => setActionError(cause.message))
      .finally(() => setPending(false));
  };

  // A single event is just the one-element case of `submitMany`.
  const submit = (type: string, payload: Record<string, unknown>): void => submitMany([{ type, payload }]);

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <Link
          href="/"
          className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          ← Board
        </Link>
      </div>

      {loading && detail === undefined && <p className="text-sm text-neutral-500">Loading...</p>}
      {error !== undefined && (
        <p className="text-sm text-red-700 dark:text-red-300">Could not load bundle: {error.message}</p>
      )}

      {detail !== undefined && (
        <>
          <div>
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{detail.bundle.name}</h3>
            <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{detail.bundle.slug}</p>
          </div>

          <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
            {TABS.map((candidate) => (
              <Link
                key={candidate.key}
                href={bundleHref(slug, candidate.key)}
                className={
                  tab === candidate.key
                    ? "border-b-2 border-neutral-900 px-2 py-1 text-xs font-medium text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
                    : "border-b-2 border-transparent px-2 py-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }
              >
                {candidate.label}
              </Link>
            ))}
          </div>

          {tab === "overview" && (
            <OverviewTab
              detail={detail}
              slug={slug}
              pending={pending}
              actionError={actionError}
              reviseNotes={reviseNotes}
              setReviseNotes={setReviseNotes}
              reviewQuestion={reviewQuestion}
              setReviewQuestion={setReviewQuestion}
              backTarget={backTarget}
              setBackTarget={setBackTarget}
              backReason={backReason}
              setBackReason={setBackReason}
              gateBasis={gateBasis}
              setGateBasis={setGateBasis}
              submit={submit}
              submitMany={submitMany}
              onChanged={refetch}
            />
          )}
          {tab === "files" && <FilesTab slug={slug} files={detail.files} initialFile={file} />}
          {tab === "versions" && (
            <VersionsTab slug={slug} drift={detail.bundle.drift} versions={detail.versions} onRecorded={refetch} />
          )}
          {tab === "evals" && (
            <EvalsTab
              slug={slug}
              fixtures={detail.fixtures}
              riskCoverage={detail.riskCoverage}
              warnings={detail.warnings}
              runs={detail.runs}
              measurements={detail.measurements}
              versions={detail.versions}
              unverified={detail.unverified}
              runId={runId}
              onOpenRun={(id) => navigate(bundleRunHref(slug, id))}
              onCloseRun={() => navigate(bundleHref(slug, "evals"))}
              onChanged={refetch}
            />
          )}
        </>
      )}
    </div>
  );
};

interface OverviewTabProps {
  readonly detail: NonNullable<ReturnType<typeof useBundleDetail>["detail"]>;
  readonly slug: string;
  readonly pending: boolean;
  readonly actionError: string | undefined;
  readonly reviseNotes: string;
  readonly setReviseNotes: (value: string) => void;
  readonly reviewQuestion: string;
  readonly setReviewQuestion: (value: string) => void;
  readonly backTarget: string;
  readonly setBackTarget: (value: string) => void;
  readonly backReason: string;
  readonly setBackReason: (value: string) => void;
  readonly gateBasis: string;
  readonly setGateBasis: (value: string) => void;
  readonly submit: (type: string, payload: Record<string, unknown>) => void;
  readonly submitMany: (events: ReadonlyArray<PostEventInput>) => void;
  readonly onChanged: () => void;
}

const OverviewTab: FC<OverviewTabProps> = ({
  detail,
  slug,
  pending,
  actionError,
  reviseNotes,
  setReviseNotes,
  reviewQuestion,
  setReviewQuestion,
  backTarget,
  setBackTarget,
  backReason,
  setBackReason,
  gateBasis,
  setGateBasis,
  submit,
  submitMany,
  onChanged,
}) => {
  const { bundle, guardStatus } = detail;
  const stage = bundle.stage;
  const action = nextAction(stage, bundle.substate, guardStatus);
  const latestReviewRequest = detail.events.find((event) => event.type === "review.requested");
  const question = stringField(latestReviewRequest?.payload, "question");
  // The exact files the station changed (review.requested's `artifacts`), so
  // the reviewer can open what they're being asked to approve -- not just read
  // its name in the question text.
  const reviewArtifacts = stringArrayField(latestReviewRequest?.payload, "artifacts");
  const forwardReady = guardStatus.approvedForForward && (stage !== "evaluating" || guardStatus.gateApproved);
  const earlier = earlierStages(stage);
  const [stationPending, setStationPending] = useState(false);
  const [stationError, setStationError] = useState<string | undefined>(undefined);

  const runCurrentStageStation = (): void => {
    if (detail.station === null) {
      return;
    }
    setStationPending(true);
    setStationError(undefined);
    triggerStationRun(slug, detail.station.state, undefined)
      .then((result) => {
        if (!result.ok) {
          setStationError(result.error);
          return;
        }
        // The station run proceeds server-side; the SSE journal stream
        // refreshes the panel as station.started/review.requested land. One
        // eager refetch so the change shows up promptly, same as FixtureRow.
        onChanged();
      })
      .catch((cause: Error) => setStationError(cause.message))
      .finally(() => setStationPending(false));
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-neutral-800 dark:text-neutral-100">
          {statusLineFor(stage, bundle.substate, forwardReady)}
        </p>
        <details className="text-[11px] text-neutral-400">
          <summary className="cursor-pointer select-none">Details</summary>
          <p className="mt-1 font-mono">
            stage {stage} · substate {bundle.substate} · approved-for-forward{" "}
            {String(guardStatus.approvedForForward)} · gate-approved {String(guardStatus.gateApproved)}
          </p>
        </details>
      </div>

      {actionError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {humanizeError(actionError)}
        </p>
      )}

      {action.kind === "terminal" && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          Published — this skill has shipped.
        </p>
      )}

      {action.kind === "gate" && (
        <>
          {/* Publishing is two conscious steps: approve the evaluation (no
              advance -- the gate does that), then clear the publish gate. */}
          {!guardStatus.approvedForForward && (
            <section className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                {bundle.substate === "awaiting-review" ? "Ready for your review" : "Approve the evaluation"}
              </h4>
              <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
                Then clear the publish gate below to ship.
              </p>
              {question !== undefined && question.length > 0 && (
                <p className="text-xs text-neutral-700 dark:text-neutral-200">{question}</p>
              )}
              {reviewArtifacts.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {reviewArtifacts.map((path) => (
                    <li key={path}>
                      <Link
                        href={bundleFileHref(slug, path)}
                        className="font-mono text-xs text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
                      >
                        {path}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  bundle.substate === "awaiting-review"
                    ? submit("review.resolved", { bundle: slug, state: stage, decision: "approve" })
                    : submitMany([
                        { type: "review.requested", payload: { bundle: slug, state: stage } },
                        { type: "review.resolved", payload: { bundle: slug, state: stage, decision: "approve" } },
                      ])
                }
                className="self-start rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Approve the evaluation
              </button>
              {bundle.substate === "awaiting-review" && (
                <>
                  <textarea
                    value={reviseNotes}
                    onChange={(event) => setReviseNotes(event.target.value)}
                    placeholder="Notes for the author (required to send back)"
                    className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                  <button
                    type="button"
                    disabled={pending || reviseNotes.trim().length === 0}
                    onClick={() =>
                      submit("review.resolved", { bundle: slug, state: stage, decision: "revise", notes: reviseNotes.trim() })
                    }
                    className="self-start rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
                  >
                    Send back with notes
                  </button>
                </>
              )}
            </section>
          )}
          <PublishSection
            slug={slug}
            approvedForForward={guardStatus.approvedForForward}
            gateApproved={guardStatus.gateApproved}
            gateBasis={gateBasis}
            setGateBasis={setGateBasis}
            onChanged={onChanged}
          />
        </>
      )}

      {action.kind === "review" && (
        <section className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Ready for your review
          </h4>
          {question !== undefined && question.length > 0 && (
            <p className="text-xs text-neutral-700 dark:text-neutral-200">{question}</p>
          )}
          {reviewArtifacts.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {reviewArtifacts.map((path) => (
                <li key={path}>
                  <Link
                    href={bundleFileHref(slug, path)}
                    className="font-mono text-xs text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
                  >
                    {path}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              submitMany([
                { type: "review.resolved", payload: { bundle: slug, state: stage, decision: "approve" } },
                { type: "bundle.stage_changed", payload: { bundle: slug, from: stage, to: action.nextStage } },
              ])
            }
            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Approve &amp; move to {STAGE_LABEL[action.nextStage]} ▸
          </button>
          <textarea
            value={reviseNotes}
            onChange={(event) => setReviseNotes(event.target.value)}
            placeholder="Notes for the author (required to send back)"
            className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            disabled={pending || reviseNotes.trim().length === 0}
            onClick={() =>
              submit("review.resolved", { bundle: slug, state: stage, decision: "revise", notes: reviseNotes.trim() })
            }
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
          >
            Send back with notes
          </button>
        </section>
      )}

      {action.kind === "advance" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("bundle.stage_changed", { bundle: slug, from: stage, to: action.nextStage })}
          className="self-start rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Move to {STAGE_LABEL[action.nextStage]} ▸
        </button>
      )}

      {action.kind === "approve-advance" && (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              // Collapse the solo review pair: request -> approve -> advance in
              // one click. review.resolved is only accepted while awaiting-review
              // (Server.ts), so the request must lead; the journal still records
              // the full pair.
              submitMany([
                { type: "review.requested", payload: { bundle: slug, state: stage } },
                { type: "review.resolved", payload: { bundle: slug, state: stage, decision: "approve" } },
                { type: "bundle.stage_changed", payload: { bundle: slug, from: stage, to: action.nextStage } },
              ])
            }
            className="self-start rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Approve &amp; move to {STAGE_LABEL[action.nextStage]} ▸
          </button>

          <details className="rounded-md border border-neutral-200 p-2 text-[11px] dark:border-neutral-800">
            <summary className="cursor-pointer select-none text-neutral-500">Other ways forward</summary>
            <div className="mt-2 flex flex-col gap-3">
              {detail.station !== null && (
                <div className="flex flex-col gap-1">
                  <p className="text-neutral-600 dark:text-neutral-300">
                    Have an agent do the {STAGE_LABEL[stage]} stage's work (skill{" "}
                    <span className="font-mono">{detail.station.skill}</span>) — it requests your review when done.
                  </p>
                  {stationError !== undefined && (
                    <p className="rounded-md bg-red-100 px-2 py-1 text-red-800 dark:bg-red-950 dark:text-red-300">
                      {stationError}
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={stationPending}
                    onClick={runCurrentStageStation}
                    className="self-start rounded-md bg-neutral-900 px-2 py-1 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                  >
                    Run station ▸
                  </button>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <p className="text-neutral-600 dark:text-neutral-300">Or hand it to someone else to review first:</p>
                <input
                  value={reviewQuestion}
                  onChange={(event) => setReviewQuestion(event.target.value)}
                  placeholder="Question for the reviewer (optional)"
                  className="w-full rounded-md border border-neutral-300 p-2 dark:border-neutral-700 dark:bg-neutral-900"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    submit("review.requested", {
                      bundle: slug,
                      state: stage,
                      ...(reviewQuestion.trim().length > 0 ? { question: reviewQuestion.trim() } : {}),
                    })
                  }
                  className="self-start rounded-md border border-neutral-300 px-2 py-1 font-medium disabled:opacity-50 dark:border-neutral-700"
                >
                  Request review
                </button>
              </div>
            </div>
          </details>
        </section>
      )}

      {stage === "published" && <PublishToTargetsSection slug={slug} />}

      {earlier.length > 0 && (
        <details className="text-[11px] text-neutral-400">
          <summary className="cursor-pointer select-none">Move to an earlier stage</summary>
          <div className="mt-2 flex flex-col gap-2">
            <select
              value={backTarget}
              onChange={(event) => setBackTarget(event.target.value)}
              className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">Select an earlier stage</option>
              {earlier.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {STAGE_LABEL[candidate]}
                </option>
              ))}
            </select>
            <input
              value={backReason}
              onChange={(event) => setBackReason(event.target.value)}
              placeholder="Reason (required)"
              className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              disabled={pending || backTarget.length === 0 || backReason.trim().length === 0}
              onClick={() =>
                submit("bundle.stage_changed", { bundle: slug, from: stage, to: backTarget, reason: backReason.trim() })
              }
              className="self-start rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
            >
              Move back
            </button>
          </div>
        </details>
      )}

      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Recent events</h4>
        <ul className="flex flex-col gap-1">
          {detail.events.map((event: EventView) => (
            <li key={event.id} className="text-[11px] text-neutral-600 dark:text-neutral-300">
              <span className="font-mono">{event.type}</span> <span className="text-neutral-400">{formatTime(event.at)}</span>
            </li>
          ))}
          {detail.events.length === 0 && <li className="text-[11px] text-neutral-400">No events yet.</li>}
        </ul>
      </section>
    </>
  );
};

/**
 * The publish action (director ruling, ui-pass-spec.md "Director rulings"
 * #1): a distinct guided flow, not the generic "advance" -- one basis input
 * drives ONE click that submits `bundle.gate_decided` (decision: approved)
 * followed by `bundle.stage_changed` to "published". Replaces the generic
 * advance button for exactly the evaluating -> published transition; every
 * other transition still uses the plain advance button in `OverviewTab`.
 */
const PublishSection: FC<{
  slug: string;
  approvedForForward: boolean;
  gateApproved: boolean;
  gateBasis: string;
  setGateBasis: (value: string) => void;
  onChanged: () => void;
}> = ({ slug, approvedForForward, gateApproved, gateBasis, setGateBasis, onChanged }) => {
  const [pending, setPending] = useState(false);
  const [publishError, setPublishError] = useState<string | undefined>(undefined);

  if (!approvedForForward) {
    return (
      <section className="flex flex-col gap-1 rounded-md border border-dashed border-neutral-300 p-3 text-[11px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        Publishing requires an approved review of &quot;evaluating&quot; first.
      </section>
    );
  }

  // The gate was already approved (e.g. a prior attempt got this far but the
  // stage-change step failed/was interrupted) -- only the second step
  // remains, so only offer that, not a redundant basis input.
  if (gateApproved) {
    return (
      <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Publish</h4>
        <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
          The publish gate is already approved. Finish moving this bundle to &quot;published&quot;.
        </p>
        {publishError !== undefined && (
          <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
            {publishError}
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setPublishError(undefined);
            postEvent({ type: "bundle.stage_changed", payload: { bundle: slug, from: "evaluating", to: "published" } })
              .then((result) => {
                if (!result.ok) {
                  setPublishError(result.error);
                  return;
                }
                onChanged();
              })
              .catch((cause: Error) => setPublishError(cause.message))
              .finally(() => setPending(false));
          }}
          className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Publish ▸
        </button>
      </section>
    );
  }

  const publish = (): void => {
    if (gateBasis.trim().length === 0) {
      return;
    }
    setPending(true);
    setPublishError(undefined);
    postEvent({
      type: "bundle.gate_decided",
      payload: { bundle: slug, gate: "publish", decision: "approved", basis: gateBasis.trim() },
    })
      .then((gateResult) => {
        if (!gateResult.ok) {
          setPublishError(gateResult.error);
          return;
        }
        return postEvent({
          type: "bundle.stage_changed",
          payload: { bundle: slug, from: "evaluating", to: "published" },
        }).then((stageResult) => {
          if (!stageResult.ok) {
            setPublishError(stageResult.error);
            return;
          }
          setGateBasis("");
          onChanged();
        });
      })
      .catch((cause: Error) => setPublishError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Publish</h4>
      <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
        Record the publish-gate decision basis and move this bundle to &quot;published&quot; in one step.
      </p>
      <input
        value={gateBasis}
        onChange={(event) => setGateBasis(event.target.value)}
        placeholder="Basis (evidence summary, required)"
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />
      {publishError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {publishError}
        </p>
      )}
      <button
        type="button"
        disabled={pending || gateBasis.trim().length === 0}
        onClick={publish}
        className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        Approve gate &amp; publish ▸
      </button>
    </section>
  );
};

/**
 * Phase 11B's post-publish step: once a bundle is `"published"`, offers a
 * "Publish to targets" button that runs core `publishBundle` server-side
 * (`POST /api/bundles/:slug/publish`, the same contract `skillmaker publish`
 * runs) against every `publishTargets` entry in `skillmaker.config.json`.
 * Renders nothing (an honest empty state -- no targets configured is a
 * normal, unremarkable workspace state) when `publishTargets` is empty.
 */
const PublishToTargetsSection: FC<{ slug: string }> = ({ slug }) => {
  const { state } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<ReadonlyArray<PublishTargetResult> | undefined>(undefined);

  const targets = state?.config.publishTargets ?? [];
  if (targets.length === 0) {
    return null;
  }

  const run = (): void => {
    setPending(true);
    setError(undefined);
    publishBundle(slug, undefined)
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setResults(result.response.results);
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Publish to targets</h4>
      <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
        {targets.length} target{targets.length === 1 ? "" : "s"} configured: {targets.map((target) => target.id).join(", ")}
      </p>
      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="w-fit rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        Publish to targets ▸
      </button>
      {results !== undefined && (
        <ul className="flex flex-col gap-1">
          {results.map((entry) => (
            <li key={entry.target} className="text-[11px] text-neutral-600 dark:text-neutral-300">
              <span className="font-mono">{entry.target}</span> ({entry.kind}):{" "}
              {entry.status === "already_published" ? "already published" : "published"}
              {entry.url !== undefined ? ` -> ${entry.url}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

const FilesTab: FC<{ slug: string; files: ReadonlyArray<string>; initialFile: string | undefined }> = ({
  slug,
  files,
  initialFile,
}) => {
  // The `?file=` deep-link wins when it names a real file (the review panel's
  // "view the changes" link lands here); otherwise default to the first file.
  const preferred = initialFile !== undefined && files.includes(initialFile) ? initialFile : files[0];
  // Only the reviewer's explicit picks live in state; everything else is
  // derived each render, so the selection can never drift out of sync with a
  // `files` list refreshed by live SSE updates (a file the reviewer picked
  // stays picked; a vanished one falls back to `preferred`).
  const [userSelected, setUserSelected] = useState<string | undefined>(undefined);
  const selected = userSelected !== undefined && files.includes(userSelected) ? userSelected : preferred;
  const [content, setContent] = useState<string | undefined>(undefined);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selected === undefined) {
      setContent(undefined);
      setFileError(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFileError(undefined);
    getBundleFile(slug, selected)
      .then((response) => {
        if (!cancelled) {
          setContent(response.content);
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setContent(undefined);
          setFileError(cause.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, selected]);

  if (files.length === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        No source files yet — design.md, research/, and output/ appear here as each stage produces them.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <select
        value={selected ?? ""}
        onChange={(event) => setUserSelected(event.target.value)}
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      >
        {files.map((path) => (
          <option key={path} value={path}>
            {path}
          </option>
        ))}
      </select>
      {loading && <p className="text-xs text-neutral-500">Loading...</p>}
      {fileError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load {selected}: {fileError}
        </p>
      )}
      {!loading && fileError === undefined && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-200 p-2 text-[11px] dark:border-neutral-800">
          {content !== undefined && content.length > 0 ? content : "(empty)"}
        </pre>
      )}
    </section>
  );
};

const VersionsTab: FC<{
  slug: string;
  drift: Drift;
  versions: ReadonlyArray<VersionRecord>;
  onRecorded: () => void;
}> = ({ slug, drift, versions, onRecorded }) => {
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [recordError, setRecordError] = useState<string | undefined>(undefined);

  const submit = (): void => {
    setPending(true);
    setRecordError(undefined);
    recordVersion(slug, label.trim().length > 0 ? label.trim() : undefined)
      .then((result) => {
        if (!result.ok) {
          setRecordError(result.error);
          return;
        }
        setLabel("");
        onRecorded();
      })
      .catch((cause: Error) => setRecordError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <section className="flex flex-col gap-3">
      <div className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${DRIFT_BADGE_CLASS[drift]}`}>
        {DRIFT_LABEL[drift]}
      </div>
      <p className="text-xs text-neutral-600 dark:text-neutral-300">{DRIFT_EXPLANATION[drift]}</p>

      {recordError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {recordError}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label (optional, e.g. v0.3)"
          className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Record version
        </button>
      </div>

      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Version history</h4>
        <ul className="flex flex-col gap-1">
          {versions.map((version) => (
            <li key={version.hash} className="text-[11px] text-neutral-600 dark:text-neutral-300">
              <span className="font-mono">{shortHash(version.hash)}</span>{" "}
              {version.label !== undefined && <span className="font-medium">{version.label}</span>}{" "}
              <span className="text-neutral-400">{formatTime(version.recordedAt)}</span>
            </li>
          ))}
          {versions.length === 0 && <li className="text-[11px] text-neutral-400">No versions recorded yet.</li>}
        </ul>
      </section>
    </section>
  );
};

/**
 * Per-fixture last-run status chip (plan.md Phase 8): completed green /
 * failed red / infra-error gray / running pulse. This is intentionally the
 * whole of Phase 8's viewer surface -- the full graded read-out (verdicts,
 * transcripts, artifacts) is Phase 9's Evals tab work, not this one's.
 */
const RUN_CHIP_STYLE: Record<RunRecord["status"], string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  "infra-error": "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  running: "animate-pulse bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
};

/**
 * One measurement chip per provider(+model) cell, for ONE fixture at the
 * CURRENT latest recorded version only (data-model.md §2.11, §1.6): a new
 * version resets validation honestly because measurements key on
 * `versionHash` -- older cells simply stop matching. "not yet measured"
 * when no completed+graded run exists for that fixture at that version.
 */
const MeasurementChips: FC<{
  measurements: ReadonlyArray<MeasurementRecord>;
  fixtureCase: string;
  latestHash: string | undefined;
  /** The recorded version at `latestHash`, if any -- Fix 4 (F6): resolves the chip's tooltip hash to its human label. */
  latestVersion?: VersionRecord;
}> = ({ measurements, fixtureCase, latestHash, latestVersion }) => {
  const cells = measurements.filter(
    (cell) => cell.fixtureCase === fixtureCase && cell.versionHash === latestHash,
  );
  if (latestHash === undefined || cells.length === 0) {
    return <span className="text-neutral-400">not yet measured</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {cells.map((cell) => {
        const providerLabel =
          cell.model.length > 0 && cell.model !== cell.provider
            ? `${cell.provider}/${cell.model}`
            : cell.provider;
        const ci =
          cell.ci === null
            ? ""
            : ` · [${Math.round(cell.ci[0] * 100)}–${Math.round(cell.ci[1] * 100)}%]`;
        // Fix 3 (F5): PASS% stays pass-only (passes / n); partial/fail are
        // their own counts here so a partial verdict never disappears from
        // the chip, even though it never contributes to the % numerator.
        const partialFail =
          cell.partial > 0 || cell.fail > 0 ? ` (${cell.partial} partial, ${cell.fail} fail)` : "";
        return (
          <span
            key={providerLabel}
            title={`${cell.passes}/${cell.n} pass, ${cell.partial} partial, ${cell.fail} fail on ${providerLabel} at ${versionLabelFor(latestVersion, cell.versionHash)}`}
            className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {providerLabel}: n={cell.n} · {Math.round(cell.passRate * 100)}%{partialFail}
            {ci}
          </span>
        );
      })}
    </span>
  );
};

/**
 * One fixture row of the read-out: header (name, class, prompt.md,
 * measurement chips, Run button + provider select when >1 provider) plus
 * that fixture's runs newest-first -- each run opens the run-detail modal.
 */
const FixtureRow: FC<{
  slug: string;
  fixture: FixtureRecord;
  runs: ReadonlyArray<RunRecord>;
  measurements: ReadonlyArray<MeasurementRecord>;
  latestHash: string | undefined;
  latestVersion?: VersionRecord;
  providers: ReadonlyArray<string>;
  onOpenRun: (runId: string) => void;
  onChanged: () => void;
}> = ({ slug, fixture, runs, measurements, latestHash, latestVersion, providers, onOpenRun, onChanged }) => {
  const [provider, setProvider] = useState<string>(providers[0] ?? "claude-code");
  // Fix 1 (Phase 20 Story 2 friction log F1): the advertised model list is
  // only known once an ACP session connects (session/new's
  // models.availableModels), so this stays a free-text id rather than a
  // pre-populated <select> -- an unknown id is rejected server-side with the
  // advertised list once the session starts.
  const [model, setModel] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [runError, setRunError] = useState<string | undefined>(undefined);

  const startRun = (): void => {
    setPending(true);
    setRunError(undefined);
    triggerRun(slug, fixture.caseName, providers.length > 0 ? provider : undefined, model.trim())
      .then((result) => {
        if (!result.ok) {
          setRunError(result.error);
          return;
        }
        // The run proceeds server-side; the SSE journal stream refreshes the
        // panel as run.started/run.completed land. One eager refetch so the
        // "running" chip shows up promptly.
        onChanged();
      })
      .catch((cause: Error) => setRunError(cause.message))
      .finally(() => setPending(false));
  };

  const fixtureRuns = runs.filter((run) => run.fixtureCase === fixture.caseName);

  return (
    <li className="flex flex-col gap-1 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
        <span className="font-mono font-medium text-neutral-900 dark:text-neutral-100">{fixture.caseName}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {fixture.class}
        </span>
        {fixture.risks.length > 0 && <span className="text-neutral-400">{fixture.risks.join(", ")}</span>}
        <span
          className={
            fixture.hasPromptMd
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-neutral-300 dark:text-neutral-600"
          }
        >
          {fixture.hasPromptMd ? "prompt.md" : "no prompt.md"}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {providers.length > 1 && (
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="rounded-md border border-neutral-300 px-1 py-0.5 text-[10px] dark:border-neutral-700 dark:bg-neutral-900"
            >
              {providers.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          )}
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="model (optional)"
            title="Model id from the provider's advertised session/new models (e.g. default, sonnet, haiku). Leave blank for the provider's own default."
            className="w-24 rounded-md border border-neutral-300 px-1 py-0.5 text-[10px] dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            disabled={pending || !fixture.hasPromptMd}
            title={fixture.hasPromptMd ? `Run ${fixture.caseName}` : "No prompt.md to run"}
            onClick={startRun}
            className="rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Run ▸
          </button>
        </span>
      </div>
      <div className="text-[11px]">
        <MeasurementChips
          measurements={measurements}
          fixtureCase={fixture.caseName}
          latestHash={latestHash}
          latestVersion={latestVersion}
        />
      </div>
      {runError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {runError}
        </p>
      )}
      {fixtureRuns.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {fixtureRuns.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onOpenRun(run.id)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RUN_CHIP_STYLE[run.status]}`}>
                  {run.status}
                </span>
                {run.verdict !== undefined && (
                  <span className="font-medium">{run.verdict}</span>
                )}
                <span className="text-neutral-400">{formatTime(run.startedAt)}</span>
                <span className="ml-auto font-mono text-[10px] text-neutral-300 dark:text-neutral-600">
                  {run.id.slice(0, 8)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

/**
 * Evals tab: Phase 7's authored coverage axis JOINED with Phase 9's
 * measured validation axis (data-model.md §2.12 -- the read-out). The
 * Validation column shows real measurement chips for the current latest
 * version; the Fixtures section lists runs (newest first) with a Run button
 * per fixture and a run-detail modal (transcript, artifacts, grading).
 */
const EvalsTab: FC<{
  slug: string;
  fixtures: ReadonlyArray<FixtureRecord>;
  riskCoverage: ReadonlyArray<RiskCoverageRecord>;
  warnings: ReadonlyArray<WarningRecord>;
  runs: ReadonlyArray<RunRecord>;
  measurements: ReadonlyArray<MeasurementRecord>;
  versions: ReadonlyArray<VersionRecord>;
  /** The Unverified badge (issue #93): received + zero graded measurements ever, at any version. Rendered here, right next to the coverage/validation display it's the honest counterpart to. */
  unverified: boolean;
  /** The open run, sourced from the route's `?run=` query param (ui-pass-spec.md §3.1/§3.4#5) -- not local state, so it survives reload/back-forward. */
  runId: string | undefined;
  onOpenRun: (runId: string) => void;
  onCloseRun: () => void;
  onChanged: () => void;
}> = ({
  slug,
  fixtures,
  riskCoverage,
  warnings,
  runs,
  measurements,
  versions,
  unverified,
  runId,
  onOpenRun,
  onCloseRun,
  onChanged,
}) => {
  const { state } = useWorkspace();
  const providers = state?.config.providers ?? [];
  // Versions arrive newest-first; measurements only count against the
  // CURRENT latest recorded version (data-model.md §1.6's honest reset).
  const latestVersion = versions[0];
  const latestHash = latestVersion?.hash;
  const families = RISK_FAMILY_ORDER.filter((family) => riskCoverage.some((row) => row.family === family));
  const otherFamilies = Array.from(
    new Set(riskCoverage.map((row) => row.family).filter((family) => !(RISK_FAMILY_ORDER as ReadonlyArray<string>).includes(family))),
  ).sort();
  const orderedFamilies = [...families, ...otherFamilies];

  return (
    <section className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <section className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Warnings
          </h4>
          <ul className="flex flex-col gap-1">
            {warnings.map((warning, index) => (
              <li key={index} className="text-[11px] text-amber-800 dark:text-amber-300">
                <span className="font-mono">[{warning.source}]</span> {warning.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {unverified && (
        <section className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/40">
          <span className="w-fit rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">
            Unverified
          </span>
          <p className="text-xs text-violet-800 dark:text-violet-300">
            Arrived from outside; we have not yet measured it.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Risk coverage</h4>
        {orderedFamilies.length === 0 && (
          <p className="text-[11px] text-neutral-400">No risk-map.md authored yet.</p>
        )}
        {orderedFamilies.map((family) => (
          <div key={family} className="flex flex-col gap-1">
            <h5 className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
              {RISK_FAMILY_LABEL[family] ?? family}
            </h5>
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-neutral-400">
                  <th className="pr-2 font-normal">Risk</th>
                  <th className="pr-2 font-normal">Coverage</th>
                  <th className="pr-2 font-normal">Fixture</th>
                  <th className="pr-2 font-normal">Validation</th>
                </tr>
              </thead>
              <tbody>
                {riskCoverage
                  .filter((row) => row.family === family)
                  .map((row) => (
                    <tr key={row.riskId} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1 pr-2 font-mono">{row.riskId}</td>
                      <td className="py-1 pr-2">
                        {COVERAGE_GLYPH[row.coverage]} {COVERAGE_LABEL[row.coverage]}
                      </td>
                      <td className="py-1 pr-2 font-mono">{row.fixtureCase ?? "—"}</td>
                      <td className="py-1 pr-2">
                        {row.fixtureCase !== undefined ? (
                          <MeasurementChips
                            measurements={measurements}
                            fixtureCase={row.fixtureCase}
                            latestHash={latestHash}
                            latestVersion={latestVersion}
                          />
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Fixtures</h4>
        <ul className="flex flex-col gap-2">
          {fixtures.map((fixture) => (
            <FixtureRow
              key={fixture.caseName}
              slug={slug}
              fixture={fixture}
              runs={runs}
              measurements={measurements}
              latestHash={latestHash}
              latestVersion={latestVersion}
              providers={providers}
              onOpenRun={onOpenRun}
              onChanged={onChanged}
            />
          ))}
          {fixtures.length === 0 && <li className="text-[11px] text-neutral-400">No fixtures yet.</li>}
        </ul>
      </section>

      {runId !== undefined && (
        <RunDetailModal slug={slug} runId={runId} onClose={onCloseRun} onGraded={onChanged} />
      )}
    </section>
  );
};
