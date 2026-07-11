/**
 * The bundle-detail / review panel (plan.md Phase 4, Phase 6): a side panel,
 * not a route change. Three tabs:
 *   - Overview: guard hints, the review pair (request/approve/revise), the
 *     publish gate, forward "advance", "move back", recent events. All
 *     writes go through `POST /api/events` (data-model.md §2.9/§2.13) via
 *     `runtime/api.ts`'s `postEvent`.
 *   - Files: read-only `design.md`/`output/SKILL.md` via
 *     `GET /api/bundles/:slug/file` (a strict allowlist -- see Server.ts).
 *   - Versions: the drift badge (data-model.md §2.7), "Record version", and
 *     version history, via `GET /api/bundles/:slug` (versions + drift are
 *     already in the detail payload) and `POST /api/bundles/:slug/record-version`.
 *
 * Reachable-409 choice (see task report): the "Advance" button stays
 * clickable even when `guardStatus` predicts a rejection -- it is only
 * styled as "not ready" and grows a one-line explanation -- rather than
 * being `disabled`. That keeps the guarded-transition 409 path reachable
 * from the UI itself (click when unapproved -> server rejects -> reason
 * shown inline), instead of requiring a separate dev-only affordance.
 */
import { type FC, useEffect, useState } from "react";
import { getBundleFile, postEvent, recordVersion } from "../runtime/api.ts";
import {
  STAGES,
  type BundleStage,
  type CoverageValue,
  type Drift,
  type EventView,
  type FixtureRecord,
  type RiskCoverageRecord,
  type RunRecord,
  type VersionRecord,
  type WarningRecord,
} from "../runtime/schemas.ts";
import { useBundleDetail } from "../runtime/useBundleDetail.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (payload: unknown, key: string): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const earlierStages = (stage: BundleStage): ReadonlyArray<BundleStage> => STAGES.slice(0, STAGES.indexOf(stage));

const nextStage = (stage: BundleStage): BundleStage | undefined => STAGES[STAGES.indexOf(stage) + 1];

const shortHash = (hash: string): string => {
  const prefix = "sha256:";
  if (!hash.startsWith(prefix)) {
    return hash;
  }
  const hex = hash.slice(prefix.length);
  return `${prefix}${hex.slice(0, 10)}`;
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

const FILE_OPTIONS: ReadonlyArray<{ readonly label: string; readonly path: string }> = [
  { label: "design.md", path: "design.md" },
  { label: "output/SKILL.md", path: "output/SKILL.md" },
];

type PanelTab = "overview" | "files" | "versions" | "evals";

const TABS: ReadonlyArray<{ readonly key: PanelTab; readonly label: string }> = [
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

export const BundlePanel: FC<{ slug: string; onClose: () => void }> = ({ slug, onClose }) => {
  const { detail, loading, error, refetch } = useBundleDetail(slug);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [reviseNotes, setReviseNotes] = useState("");
  const [reviewQuestion, setReviewQuestion] = useState("");
  const [backTarget, setBackTarget] = useState("");
  const [backReason, setBackReason] = useState("");
  const [gateBasis, setGateBasis] = useState("");

  const submit = (type: string, payload: Record<string, unknown>): void => {
    setPending(true);
    setActionError(undefined);
    postEvent({ type, payload })
      .then((result) => {
        if (!result.ok) {
          setActionError(result.error);
          return;
        }
        setActionError(undefined);
        refetch();
      })
      .catch((cause: Error) => setActionError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-start justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Bundle detail
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          Close
        </button>
      </div>

      {loading && detail === undefined && <p className="text-sm text-neutral-500">Loading...</p>}
      {error !== undefined && (
        <p className="text-sm text-red-700 dark:text-red-300">Could not load bundle: {error.message}</p>
      )}

      {detail !== undefined && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{detail.bundle.name}</h3>
            <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{detail.bundle.slug}</p>
          </div>

          <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
            {TABS.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                onClick={() => setTab(candidate.key)}
                className={
                  tab === candidate.key
                    ? "border-b-2 border-neutral-900 px-2 py-1 text-xs font-medium text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
                    : "border-b-2 border-transparent px-2 py-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }
              >
                {candidate.label}
              </button>
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
            />
          )}
          {tab === "files" && <FilesTab slug={slug} />}
          {tab === "versions" && (
            <VersionsTab slug={slug} drift={detail.bundle.drift} versions={detail.versions} onRecorded={refetch} />
          )}
          {tab === "evals" && (
            <EvalsTab
              fixtures={detail.fixtures}
              riskCoverage={detail.riskCoverage}
              warnings={detail.warnings}
              runs={detail.runs}
            />
          )}
        </>
      )}
    </aside>
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
}) => {
  const { bundle, guardStatus } = detail;
  const stage = bundle.stage;
  const next = nextStage(stage);
  const awaitingReview = bundle.substate === "awaiting-review";
  const latestReviewRequest = detail.events.find((event) => event.type === "review.requested");
  const question = stringField(latestReviewRequest?.payload, "question");
  const forwardReady = guardStatus.approvedForForward && (stage !== "evaluating" || guardStatus.gateApproved);
  const earlier = earlierStages(stage);

  return (
    <>
      <div className="text-xs text-neutral-600 dark:text-neutral-300">
        <p>
          Stage: <span className="font-medium">{stage}</span>
        </p>
        <p>
          Substate: <span className="font-medium">{bundle.substate}</span>
        </p>
        <p>
          Guard: approved-for-forward <span className="font-medium">{String(guardStatus.approvedForForward)}</span>,
          gate-approved <span className="font-medium">{String(guardStatus.gateApproved)}</span>
        </p>
      </div>

      {actionError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </p>
      )}

      {awaitingReview ? (
        <section className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Awaiting review
          </h4>
          {question !== undefined && question.length > 0 && (
            <p className="text-xs text-neutral-700 dark:text-neutral-200">{question}</p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("review.resolved", { bundle: slug, state: stage, decision: "approve" })}
            className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Approve
          </button>
          <textarea
            value={reviseNotes}
            onChange={(event) => setReviseNotes(event.target.value)}
            placeholder="Notes for revise (required)"
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
            Revise
          </button>
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <input
            value={reviewQuestion}
            onChange={(event) => setReviewQuestion(event.target.value)}
            placeholder="Question for the reviewer (optional)"
            className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
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
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
          >
            Request review
          </button>
        </section>
      )}

      {stage === "evaluating" && guardStatus.approvedForForward && !guardStatus.gateApproved && (
        <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Decide publish gate</h4>
          <input
            value={gateBasis}
            onChange={(event) => setGateBasis(event.target.value)}
            placeholder="Basis (evidence summary)"
            className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            disabled={pending || gateBasis.trim().length === 0}
            onClick={() =>
              submit("bundle.gate_decided", {
                bundle: slug,
                gate: "publish",
                decision: "approved",
                basis: gateBasis.trim(),
              })
            }
            className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Approve publish gate
          </button>
        </section>
      )}

      {next !== undefined && (
        <section className="flex flex-col gap-1">
          <button
            type="button"
            disabled={pending}
            title={
              forwardReady
                ? `Advance to "${next}"`
                : stage === "evaluating"
                  ? "Requires an approved review of evaluating AND an approved publish gate"
                  : `Requires an approved review of "${stage}"`
            }
            onClick={() => submit("bundle.stage_changed", { bundle: slug, from: stage, to: next })}
            className={
              forwardReady
                ? "rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                : "rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-500 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-400"
            }
          >
            Advance to &quot;{next}&quot; ▸
          </button>
          {!forwardReady && (
            <p className="text-[10px] text-neutral-400">
              Not guard-approved yet -- clicking still submits and shows the server&apos;s rejection reason.
            </p>
          )}
        </section>
      )}

      {earlier.length > 0 && (
        <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Move back</h4>
          <select
            value={backTarget}
            onChange={(event) => setBackTarget(event.target.value)}
            className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Select an earlier stage</option>
            {earlier.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
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
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
          >
            Move back
          </button>
        </section>
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

const FilesTab: FC<{ slug: string }> = ({ slug }) => {
  const [selected, setSelected] = useState<string>(FILE_OPTIONS[0]?.path ?? "design.md");
  const [content, setContent] = useState<string | undefined>(undefined);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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

  return (
    <section className="flex flex-col gap-2">
      <select
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      >
        {FILE_OPTIONS.map((option) => (
          <option key={option.path} value={option.path}>
            {option.label}
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

const LastRunChip: FC<{ run: RunRecord | undefined }> = ({ run }) => {
  if (run === undefined) {
    return <span className="text-neutral-300 dark:text-neutral-600">no runs</span>;
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RUN_CHIP_STYLE[run.status]}`}
      title={`run ${run.id} at ${run.startedAt}`}
    >
      {run.status}
    </span>
  );
};

/**
 * Evals tab (plan.md Phase 7): the risk-map coverage axis grouped by family,
 * the scanned fixtures, and any reindex-time warnings. The Validation column
 * always reads "not yet measured" -- actual measurement runs land in Phase
 * 9; this tab only ever reports what has been *authored*, never a result,
 * except for the per-fixture last-run chip added in Phase 8.
 */
const EvalsTab: FC<{
  fixtures: ReadonlyArray<FixtureRecord>;
  riskCoverage: ReadonlyArray<RiskCoverageRecord>;
  warnings: ReadonlyArray<WarningRecord>;
  runs: ReadonlyArray<RunRecord>;
}> = ({ fixtures, riskCoverage, warnings, runs }) => {
  const lastRunByFixture = new Map<string, RunRecord>();
  // `runs` arrives newest-first from the server, so the first hit per
  // fixture case is the last run -- no extra sort needed here.
  for (const run of runs) {
    if (run.fixtureCase !== undefined && !lastRunByFixture.has(run.fixtureCase)) {
      lastRunByFixture.set(run.fixtureCase, run);
    }
  }
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
                      <td className="py-1 pr-2 text-neutral-400">not yet measured</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Fixtures</h4>
        <ul className="flex flex-col gap-1">
          {fixtures.map((fixture) => (
            <li
              key={fixture.caseName}
              className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300"
            >
              <span className="font-mono">{fixture.caseName}</span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {fixture.class}
              </span>
              {fixture.risks.length > 0 && (
                <span className="text-neutral-400">{fixture.risks.join(", ")}</span>
              )}
              <span className={fixture.hasPromptMd ? "text-emerald-600 dark:text-emerald-400" : "text-neutral-300 dark:text-neutral-600"}>
                {fixture.hasPromptMd ? "prompt.md" : "no prompt.md"}
              </span>
              <LastRunChip run={lastRunByFixture.get(fixture.caseName)} />
            </li>
          ))}
          {fixtures.length === 0 && <li className="text-[11px] text-neutral-400">No fixtures yet.</li>}
        </ul>
      </section>
    </section>
  );
};
