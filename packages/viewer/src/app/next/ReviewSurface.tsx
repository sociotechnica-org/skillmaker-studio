/**
 * The Skill page's production-loop surfaces (ruled 2026-07-23):
 *
 * 1. Advance controls -- a compact row near the top (placement disposable;
 *    the director repositions later). Forward: "Move to <next>" when the
 *    guard already allows it; "Approve & move to <next>" (director
 *    sign-off) when nothing is pending -- that click records the full
 *    review pair (request -> approve) then the stage move, the same
 *    collapse SkillCard's approve-advance performs, so the solo
 *    self-approval is one click while the journal keeps the whole story.
 *    Backward: an expandable "Move to an earlier stage" with the REQUIRED
 *    reason (the legal-backward mechanic). Honest errors inline -- a
 *    guard 409's reason is shown verbatim.
 * 2. The pinned review card when the bundle awaits review, titled by the
 *    state that REQUESTED it (#130: never the current stage's costume),
 *    with the produced files as a plain list, approve (notes optional) and
 *    send back (notes required) via loopApi.
 * 3. The latest review outcome (decision · timestamp · notes verbatim),
 *    kept visible under the card after acting.
 *
 * Refetch-after-acting rides the journal tick: every action here appends
 * an event, the SSE stream ticks, and useSkillPage refetches -- no manual
 * cache pokes. Hidden entirely on placeholder data (`loop === null`).
 */
import { useState } from "react";
import { postEvent } from "../runtime/api.ts";
import { STAGE_FROM_WIRE } from "./api.ts";
import { advanceStage, moveBackStage, nextStage, resolveReview, type LoopActionResult } from "./loopApi.ts";
import { STAGES as WIRE_STAGES } from "../runtime/schemas.ts";
import { Button } from "./ui.tsx";
import type { SkillLoop, WireStage } from "./types.ts";

/** Display word for a wire stage, in the NEXT shell's own vocabulary. */
const stageWord = (stage: WireStage): string => STAGE_FROM_WIRE[stage];

/**
 * Director sign-off from a working state: record the review pair (request
 * -> approve) then advance -- `review.resolved` is only accepted while
 * awaiting-review, so the request must lead. Stops at the first refusal;
 * the journal keeps whatever honestly happened.
 */
const signOffAndAdvance = async (slug: string, stage: WireStage): Promise<LoopActionResult> => {
  const requested = await postEvent({ type: "review.requested", payload: { bundle: slug, state: stage } });
  if (!requested.ok) return { ok: false, error: requested.error };
  const approved = await resolveReview(slug, stage, "approve", undefined);
  if (!approved.ok) return approved;
  return advanceStage(slug, stage);
};

const fmtAt = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export function ReviewSurface({ loop }: { readonly loop: SkillLoop }) {
  return (
    <div className="pb-4">
      <AdvanceControls loop={loop} />
      {loop.substate === "awaiting-review" && <ReviewCard loop={loop} />}
      {loop.outcome !== undefined && <OutcomeLine outcome={loop.outcome} />}
    </div>
  );
}

// -------------------------------------------------------------- advance

function AdvanceControls({ loop }: { readonly loop: SkillLoop }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backOpen, setBackOpen] = useState(false);
  const earlier = WIRE_STAGES.slice(0, WIRE_STAGES.indexOf(loop.stage));
  const [backTo, setBackTo] = useState<WireStage>(earlier[0] ?? "idea");
  const [reason, setReason] = useState("");
  const next = nextStage(loop.stage);

  const act = (run: () => Promise<LoopActionResult>) => {
    setBusy(true);
    setError(null);
    void run().then((result) => {
      setBusy(false);
      if (!result.ok) setError(result.error);
      // Success needs no local mutation: the journal append ticks the SSE
      // stream and the page refetches itself.
    });
  };

  const forward =
    next === undefined || loop.substate === "awaiting-review" ? null : loop.approvedForForward ? (
      <Button
        primary
        disabled={busy}
        label={`Move to ${stageWord(next)}`}
        title="The guard already allows this move (an approved review is on record)."
        onClick={() => act(() => advanceStage(loop.slug, loop.stage))}
      />
    ) : (
      <Button
        primary
        disabled={busy}
        label={`Approve & move to ${stageWord(next)}`}
        title="Director sign-off: records the review pair (request, approve) in the journal, then advances."
        onClick={() => act(() => signOffAndAdvance(loop.slug, loop.stage))}
      />
    );

  if (forward === null && earlier.length === 0) return null;

  return (
    <div className="pb-3">
      <div className="flex flex-wrap items-center gap-2">
        {forward}
        {earlier.length > 0 && (
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface hover:text-ink"
            onClick={() => setBackOpen(!backOpen)}
          >
            {backOpen ? "Cancel" : "Move to an earlier stage…"}
          </button>
        )}
      </div>
      {backOpen && earlier.length > 0 && (
        <div className="mt-2 rounded border border-border bg-surface p-3 text-sm shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">Back to</span>
            <select
              className="cursor-pointer rounded border border-border bg-transparent px-1.5 py-0.5 text-xs outline-none"
              value={backTo}
              onChange={(event) => setBackTo(event.target.value as WireStage)}
            >
              {earlier.map((stage) => (
                <option key={stage} value={stage}>
                  {stageWord(stage)}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="mt-2 w-full rounded border border-border bg-transparent p-2 text-sm outline-none focus:border-amber-300"
            rows={2}
            placeholder="Why is this going back? (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="pt-1">
            <Button
              disabled={busy}
              label={`Move back to ${stageWord(backTo)}`}
              onClick={() => act(() => moveBackStage(loop.slug, loop.stage, backTo, reason))}
            />
          </div>
        </div>
      )}
      {error !== null && <p className="pt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// -------------------------------------------------------------- review card

function ReviewCard({ loop }: { readonly loop: SkillLoop }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = loop.pending;
  const requestedState = pending?.requestedState;
  // #130: the card is named for the REQUESTING station's state. When the
  // capped event window no longer holds the request, fall back to a generic
  // title -- never the current stage's costume.
  const title =
    requestedState !== undefined ? `Review the ${stageWord(requestedState)} work` : "Review the submitted work";
  const stale =
    requestedState !== undefined && requestedState !== loop.stage
      ? `Requested by the ${stageWord(requestedState)} station; this skill has since moved to ${stageWord(loop.stage)}.`
      : null;
  // The wire state the resolution must name: the requesting station's,
  // falling back to the current stage (the server 409s honestly if stale).
  const wireState = requestedState ?? loop.stage;

  const act = (decision: "approve" | "revise") => {
    setBusy(true);
    setError(null);
    void resolveReview(loop.slug, wireState, decision, notes.length > 0 ? notes : undefined).then((result) => {
      setBusy(false);
      if (!result.ok) setError(result.error);
      // On success the journal tick refetches the page; the card retires
      // itself when the substate flips back to working.
    });
  };

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-4 shadow-sm">
      <div className="pb-1 font-display text-xs uppercase tracking-widest text-ink-muted">awaiting review</div>
      <h2 className="font-display text-lg">{title}</h2>
      {stale !== null && <p className="pt-1 text-xs text-ink-muted">{stale}</p>}
      {pending?.question !== undefined && <p className="pt-2 text-sm">{pending.question}</p>}
      {pending !== undefined && pending.artifacts.length > 0 && (
        <ul className="pt-2 text-sm">
          {pending.artifacts.map((path) => (
            <li key={path} className="font-mono text-xs text-ink-muted">
              {path}
            </li>
          ))}
        </ul>
      )}
      <textarea
        className="mt-3 w-full rounded border border-border bg-surface p-2 text-sm outline-none focus:border-amber-300"
        rows={2}
        placeholder="Notes — optional on approve, required to send back"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <div className="flex gap-2 pt-2">
        <Button primary disabled={busy} label="Approve" onClick={() => act("approve")} />
        <Button
          disabled={busy}
          label="Send back with notes"
          title="Send back requires notes — say what needs to change."
          onClick={() => act("revise")}
        />
      </div>
      {error !== null && <p className="pt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// -------------------------------------------------------------- outcome

function OutcomeLine({ outcome }: { readonly outcome: NonNullable<SkillLoop["outcome"]> }) {
  return (
    <div className="mt-2 rounded border border-border bg-surface p-3 text-sm shadow-sm">
      <span className="font-display">{outcome.decision === "approve" ? "Approved" : "Sent back"}</span>
      <span className="text-ink-muted"> · {fmtAt(outcome.at)}</span>
      {outcome.notes !== undefined && <p className="whitespace-pre-wrap pt-1 text-sm">{outcome.notes}</p>}
    </div>
  );
}
