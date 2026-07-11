/**
 * The bundle-detail / review panel (plan.md Phase 4): a side panel, not a
 * route change. Shows guard hints, the review pair (request/approve/
 * revise), the publish gate, forward "advance", and "move back". All writes
 * go through `POST /api/events` (data-model.md §2.9/§2.13) via
 * `runtime/api.ts`'s `postEvent`.
 *
 * Reachable-409 choice (see task report): the "Advance" button stays
 * clickable even when `guardStatus` predicts a rejection -- it is only
 * styled as "not ready" and grows a one-line explanation -- rather than
 * being `disabled`. That keeps the guarded-transition 409 path reachable
 * from the UI itself (click when unapproved -> server rejects -> reason
 * shown inline), instead of requiring a separate dev-only affordance.
 */
import { type FC, useState } from "react";
import { postEvent } from "../runtime/api.ts";
import { STAGES, type BundleStage, type EventView } from "../runtime/schemas.ts";
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

export const BundlePanel: FC<{ slug: string; onClose: () => void }> = ({ slug, onClose }) => {
  const { detail, loading, error, refetch } = useBundleDetail(slug);
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
        <BundlePanelBody
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
    </aside>
  );
};

interface BundlePanelBodyProps {
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

const BundlePanelBody: FC<BundlePanelBodyProps> = ({
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
      <div>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{bundle.name}</h3>
        <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{bundle.slug}</p>
      </div>

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
