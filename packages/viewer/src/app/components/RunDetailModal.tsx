/**
 * The read-out's run detail surface (data-model.md §2.12), opened by
 * clicking a run in the Evals tab. A centered MODAL overlay rather than an
 * expanding section -- the bundle panel is a 24rem side panel, far too
 * narrow to render a transcript readably, and the read-out is the moment
 * the whole phase exists for.
 *
 * Four sections: run header, transcript (role-tagged; tool calls and raw
 * protocol collapsed to expandable one-liners; permission entries
 * highlighted), artifacts (contents fetched through the same allowlisted
 * file endpoint as the Files tab), and the grading panel + history. A grade
 * submit POSTs one `run.graded` event (data-model.md §2.9) -- a regrade is
 * a brand-new event, shown as history with the latest bold.
 */
import { type FC, useEffect, useState } from "react";
import { getBundleFile, postEvent } from "../runtime/api.ts";
import { buildRunTodoPayload } from "../runtime/runTodoDraft.ts";
import type { EventView, RunDetailRun, RunStatus, RunVerdict } from "../runtime/schemas.ts";
import { useRunDetail } from "../runtime/useRunDetail.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

const STATUS_CHIP: Record<RunStatus, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  "infra-error": "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  running: "animate-pulse bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
};

const VERDICT_CHIP: Record<RunVerdict, string> = {
  pass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  fail: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
};

const VERDICTS: ReadonlyArray<RunVerdict> = ["pass", "fail", "partial"];

// ---------------------------------------------------------------------------
// Transcript rendering
// ---------------------------------------------------------------------------

interface RenderedEntry {
  /** Left-column tag: who/what this line is. */
  readonly role: string;
  /** One-line summary, always shown. */
  readonly summary: string;
  /** Full detail behind an expander; undefined = nothing to expand. */
  readonly detail: string | undefined;
  /** Visual treatment. */
  readonly tone: "agent" | "prompt" | "tool" | "permission" | "protocol" | "malformed";
}

const asText = (content: unknown): string | undefined => {
  if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
    return content.text;
  }
  return undefined;
};

const promptText = (params: unknown): string => {
  if (isRecord(params) && Array.isArray(params.prompt)) {
    const texts = params.prompt
      .map(asText)
      .filter((text): text is string => text !== undefined);
    if (texts.length > 0) return texts.join("\n");
  }
  return "(prompt)";
};

/**
 * Classifies one raw transcript line ({t, dir, message} with a JSON-RPC
 * message) into a renderable entry. Everything unknown degrades to a
 * collapsed "protocol" one-liner -- never a blank hole, never a crash.
 */
const renderEntry = (raw: unknown): RenderedEntry => {
  if (!isRecord(raw)) {
    return { role: "??", summary: String(raw), detail: undefined, tone: "malformed" };
  }
  if (raw.malformed === true) {
    return {
      role: "??",
      summary: "malformed transcript line",
      detail: typeof raw.raw === "string" ? raw.raw : JSON.stringify(raw),
      tone: "malformed",
    };
  }

  const dir = typeof raw.dir === "string" ? raw.dir : "";
  const message = raw.message;
  const json = JSON.stringify(message, null, 2);

  if (dir === "synthetic") {
    return {
      role: "permission",
      summary: "auto-approved permission decision (runner-injected)",
      detail: json,
      tone: "permission",
    };
  }

  if (isRecord(message) && typeof message.method === "string") {
    const method = message.method;
    const params = message.params;

    if (method === "session/request_permission") {
      return { role: "permission", summary: "permission requested", detail: json, tone: "permission" };
    }
    if (method === "session/prompt") {
      return { role: "prompt", summary: promptText(params), detail: json, tone: "prompt" };
    }
    if (method === "session/update" && isRecord(params) && isRecord(params.update)) {
      const update = params.update;
      const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "update";
      if (kind === "agent_message_chunk") {
        const text = asText(update.content);
        return { role: "agent", summary: text ?? "(non-text chunk)", detail: text === undefined ? json : undefined, tone: "agent" };
      }
      if (kind === "tool_call" || kind === "tool_call_update") {
        const title = typeof update.title === "string" ? update.title : kind;
        return { role: "tool", summary: title, detail: json, tone: "tool" };
      }
      return { role: "update", summary: kind, detail: json, tone: "protocol" };
    }
    return { role: dir === "send" ? "client" : "adapter", summary: method, detail: json, tone: "protocol" };
  }

  // A JSON-RPC response (result/error, no method).
  const label = isRecord(message) && "error" in message ? "error response" : "response";
  return { role: dir === "send" ? "client" : "adapter", summary: label, detail: json, tone: "protocol" };
};

const ENTRY_TONE_CLASS: Record<RenderedEntry["tone"], string> = {
  agent: "text-neutral-800 dark:text-neutral-200",
  prompt: "text-neutral-800 dark:text-neutral-200",
  tool: "text-neutral-600 dark:text-neutral-400",
  permission: "rounded bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  protocol: "text-neutral-400 dark:text-neutral-500",
  malformed: "text-red-700 dark:text-red-400",
};

const TranscriptEntryRow: FC<{ entry: RenderedEntry }> = ({ entry }) => {
  const roleTag = (
    <span className="mr-2 inline-block w-20 shrink-0 text-right font-mono text-[10px] uppercase text-neutral-400 dark:text-neutral-500">
      {entry.role}
    </span>
  );
  if (entry.detail === undefined) {
    return (
      <div className={`flex items-start px-1 py-0.5 text-[11px] ${ENTRY_TONE_CLASS[entry.tone]}`}>
        {roleTag}
        <span className="whitespace-pre-wrap">{entry.summary}</span>
      </div>
    );
  }
  return (
    <details className={`px-1 py-0.5 text-[11px] ${ENTRY_TONE_CLASS[entry.tone]}`}>
      <summary className="flex cursor-pointer items-start">
        {roleTag}
        <span className="whitespace-pre-wrap">{entry.summary}</span>
      </summary>
      <pre className="ml-24 mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-neutral-200 p-2 text-[10px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {entry.detail}
      </pre>
    </details>
  );
};

// ---------------------------------------------------------------------------
// Grading history
// ---------------------------------------------------------------------------

const gradeField = (payload: unknown, key: string): unknown =>
  isRecord(payload) ? payload[key] : undefined;

const isVerdict = (value: unknown): value is RunVerdict =>
  value === "pass" || value === "fail" || value === "partial";

const GradingHistoryRow: FC<{ event: EventView; latest: boolean }> = ({ event, latest }) => {
  const verdict = gradeField(event.payload, "verdict");
  const notes = gradeField(event.payload, "notes");
  const checks = gradeField(event.payload, "checks");
  const passedChecks = Array.isArray(checks)
    ? `${checks.filter((c) => isRecord(c) && c.pass === true).length}/${checks.length} checks`
    : undefined;
  const verdictClass = isVerdict(verdict)
    ? VERDICT_CHIP[verdict]
    : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300";
  return (
    <li className={`flex flex-col gap-0.5 text-[11px] ${latest ? "font-semibold text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"}`}>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${verdictClass}`}>
          {typeof verdict === "string" ? verdict : "?"}
        </span>
        {passedChecks !== undefined && <span className="font-normal">{passedChecks}</span>}
        <span className="font-normal text-neutral-400">
          {formatTime(event.at)} · {event.actor.name}
        </span>
        {latest && <span className="text-[10px] uppercase tracking-wide text-neutral-400">latest</span>}
      </div>
      {typeof notes === "string" && notes.length > 0 && (
        <p className="font-normal text-neutral-600 dark:text-neutral-300">{notes}</p>
      )}
    </li>
  );
};

// ---------------------------------------------------------------------------
// Grading panel
// ---------------------------------------------------------------------------

const GradingPanel: FC<{
  runId: string;
  checks: ReadonlyArray<string>;
  onGraded: () => void;
}> = ({ runId, checks, onGraded }) => {
  const [verdict, setVerdict] = useState<RunVerdict | undefined>(undefined);
  const [checked, setChecked] = useState<ReadonlyArray<boolean>>(checks.map(() => false));
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [gradeError, setGradeError] = useState<string | undefined>(undefined);
  const [submitted, setSubmitted] = useState(false);

  // A regrade of a different run (modal reused) or a changed checklist
  // resets local state.
  useEffect(() => {
    setVerdict(undefined);
    setChecked(checks.map(() => false));
    setNotes("");
    setGradeError(undefined);
    setSubmitted(false);
  }, [runId, checks]);

  const submit = (): void => {
    if (verdict === undefined) return;
    setPending(true);
    setGradeError(undefined);
    const payload: Record<string, unknown> = {
      id: runId,
      verdict,
      ...(checks.length > 0
        ? { checks: checks.map((text, i) => ({ text, pass: checked[i] === true })) }
        : {}),
      ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
    };
    // No idempotencyKey on purpose: every grade submission -- including a
    // regrade -- is a genuinely new event; the fold keeps history and the
    // latest wins (data-model.md §2.9).
    postEvent({ type: "run.graded", payload })
      .then((result) => {
        if (!result.ok) {
          setGradeError(result.error);
          return;
        }
        setSubmitted(true);
        onGraded();
      })
      .catch((cause: Error) => setGradeError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Grade this run</h4>
      <div className="flex gap-2">
        {VERDICTS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setVerdict(candidate)}
            className={
              verdict === candidate
                ? `rounded-md px-3 py-1 text-xs font-semibold ring-2 ring-neutral-900 dark:ring-neutral-100 ${VERDICT_CHIP[candidate]}`
                : `rounded-md px-3 py-1 text-xs font-medium opacity-70 hover:opacity-100 ${VERDICT_CHIP[candidate]}`
            }
          >
            {candidate}
          </button>
        ))}
      </div>
      {checks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {checks.map((text, i) => (
            <li key={text}>
              <label className="flex items-start gap-2 text-[11px] text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={checked[i] === true}
                  onChange={(event) =>
                    setChecked(checked.map((value, j) => (j === i ? event.target.checked : value)))
                  }
                  className="mt-0.5"
                />
                <span>{text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Notes (optional)"
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />
      {gradeError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {gradeError}
        </p>
      )}
      <button
        type="button"
        disabled={pending || verdict === undefined}
        onClick={submit}
        className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {submitted ? "Submit regrade" : "Submit grade"}
      </button>
      {verdict === undefined && (
        <p className="text-[10px] text-neutral-400">Pick a verdict to enable submit.</p>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Run findings become work (2026-07-21 simplification, D5)
// ---------------------------------------------------------------------------

/**
 * The read-out's SECOND affordance, alongside grading: "this run surfaced
 * work -> open a todo." A small form (title, optional note) that POSTs one
 * `todo.opened` event with `origin: {kind: "run", runId}` stamped, so the
 * queue item links back to this run's transcript as evidence (Ruling 4 of
 * the 2026-07-20 restructure proposal: the grade judges the agent; the
 * finding is a different judgment about a different object, and it must not
 * evaporate when the grade lands). Verdict and disposition stay orthogonal:
 * this panel renders for every run regardless of status or grade, opening a
 * todo neither requires nor implies any verdict, and grading never requires
 * a todo.
 */
const RunTodoPanel: FC<{ run: RunDetailRun }> = ({ run }) => {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [todoError, setTodoError] = useState<string | undefined>(undefined);
  const [openedId, setOpenedId] = useState<string | undefined>(undefined);

  // A different run (modal reused) resets local state.
  useEffect(() => {
    setTitle("");
    setNote("");
    setTodoError(undefined);
    setOpenedId(undefined);
  }, [run.id]);

  const submit = (): void => {
    const payload = buildRunTodoPayload({
      run,
      title,
      note,
      id: `td-${crypto.randomUUID()}`,
      created: new Date().toISOString().slice(0, 10),
    });
    if (payload === undefined) return;
    setPending(true);
    setTodoError(undefined);
    // Widened like GradingPanel's payload: PostEventInput carries a plain
    // Record; the server's dry-decode is the real shape check.
    const body: Record<string, unknown> = { todo: payload.todo };
    postEvent({ type: "todo.opened", payload: body })
      .then((result) => {
        if (!result.ok) {
          setTodoError(result.error);
          return;
        }
        setOpenedId(payload.todo.id);
        setTitle("");
        setNote("");
      })
      .catch((cause: Error) => setTodoError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        This run surfaced work
      </h4>
      <p className="text-[10px] text-neutral-400">
        Open a todo carrying this run as evidence -- independent of any grade.
      </p>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What needs doing?"
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note (optional)"
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />
      {todoError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {todoError}
        </p>
      )}
      {openedId !== undefined && (
        <p className="rounded-md bg-emerald-100 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          Opened todo {openedId} -- it links back to this run.
        </p>
      )}
      <button
        type="button"
        disabled={pending || title.trim().length === 0}
        onClick={submit}
        className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        Open a todo
      </button>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/**
 * Every artifact except `response.md` is a COPY captured from the eval
 * sandbox into `runs/<id>/artifacts/` -- e.g. `output/SKILL.md` here is the
 * sandbox's file, not the bundle's real distributable at the same relative
 * path. Appendix fault #1 (2026-07-20 proposal): labeling the chip with the
 * bare path made it read as "the eval wrote into my skill file", a lie about
 * provenance. So sandbox chips carry a "sandbox" tag and a tooltip naming
 * where the copy actually lives.
 */
const sandboxArtifactTitle = (runId: string, artifact: string): string =>
  `Sandbox copy captured at runs/${runId}/artifacts/${artifact} -- not the bundle's own ${artifact}.`;

const ArtifactViewer: FC<{ slug: string; runId: string; artifacts: ReadonlyArray<string> }> = ({
  slug,
  runId,
  artifacts,
}) => {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [content, setContent] = useState<string | undefined>(undefined);
  const [fileError, setFileError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (selected === undefined) {
      setContent(undefined);
      setFileError(undefined);
      return;
    }
    let cancelled = false;
    // "response.md" (finding #5) lives directly under `runs/<id>/`, a
    // sibling of `artifacts/`, not inside it -- see Server.ts's
    // `handleRunDetail` for why it's still listed in `artifacts` first.
    const fetchPath =
      selected === "response.md" ? `runs/${runId}/response.md` : `runs/${runId}/artifacts/${selected}`;
    getBundleFile(slug, fetchPath)
      .then((response) => {
        if (!cancelled) {
          setContent(response.content);
          setFileError(undefined);
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setContent(undefined);
          setFileError(cause.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug, runId, selected]);

  if (artifacts.length === 0) {
    return <p className="text-[11px] text-neutral-400">No artifacts.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-wrap gap-1">
        {artifacts.map((artifact) => {
          const sandboxed = artifact !== "response.md";
          return (
            <li key={artifact}>
              <button
                type="button"
                onClick={() => setSelected(selected === artifact ? undefined : artifact)}
                title={sandboxed ? sandboxArtifactTitle(runId, artifact) : undefined}
                className={
                  selected === artifact
                    ? "inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2 py-0.5 font-mono text-[10px] text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-0.5 font-mono text-[10px] text-neutral-600 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-300"
                }
              >
                {sandboxed && (
                  <span className="rounded-full bg-violet-100 px-1.5 text-[9px] font-medium uppercase tracking-wide text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                    sandbox
                  </span>
                )}
                {artifact}
              </button>
            </li>
          );
        })}
      </ul>
      {fileError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load {selected}: {fileError}
        </p>
      )}
      {selected !== undefined && content !== undefined && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-200 p-2 text-[11px] dark:border-neutral-800">
          {content.length > 0 ? content : "(empty)"}
        </pre>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The modal
// ---------------------------------------------------------------------------

export const RunDetailModal: FC<{
  slug: string;
  runId: string;
  onClose: () => void;
  /** Fired after a successful grade so the parent can refresh measurements immediately (SSE will too). */
  onGraded: () => void;
}> = ({ slug, runId, onClose, onGraded }) => {
  const { detail, loading, error, refetch } = useRunDetail(slug, runId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
        <div className="flex items-start justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Run detail
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
          <p className="text-sm text-red-700 dark:text-red-300">Could not load run: {error.message}</p>
        )}

        {detail !== undefined && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
              <span className="font-mono text-neutral-900 dark:text-neutral-100">
                {detail.run.fixtureCase ?? "(no fixture)"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[detail.run.status]}`}
              >
                {detail.run.status}
              </span>
              <span className="font-mono text-[10px] text-neutral-400">{detail.run.id}</span>
              <span>
                {detail.run.provider}
                {detail.run.model.length > 0 && detail.run.model !== detail.run.provider
                  ? ` / ${detail.run.model}`
                  : ""}
              </span>
              <span className="text-neutral-400">
                {formatTime(detail.run.startedAt)}
                {detail.run.endedAt !== undefined ? ` -> ${formatTime(detail.run.endedAt)}` : ""}
              </span>
            </div>

            <section className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Transcript</h4>
              {detail.transcript.length === 0 ? (
                <p className="text-[11px] text-neutral-400">No transcript.</p>
              ) : (
                <div className="max-h-80 overflow-y-auto rounded-md border border-neutral-200 py-1 dark:border-neutral-800">
                  {detail.transcript.map((raw, index) => (
                    <TranscriptEntryRow key={index} entry={renderEntry(raw)} />
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Artifacts</h4>
              <ArtifactViewer slug={slug} runId={runId} artifacts={detail.artifacts} />
            </section>

            {detail.run.status === "completed" ? (
              <GradingPanel
                runId={runId}
                checks={detail.checks}
                onGraded={() => {
                  refetch();
                  onGraded();
                }}
              />
            ) : (
              <p className="text-[11px] text-neutral-400">
                Only completed runs are graded -- this run is &quot;{detail.run.status}&quot;.
              </p>
            )}

            <RunTodoPanel run={detail.run} />

            <section className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Grading history
              </h4>
              {detail.gradingHistory.length === 0 ? (
                <p className="text-[11px] text-neutral-400">Not graded yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {detail.gradingHistory.map((event, index) => (
                    <GradingHistoryRow key={event.id} event={event} latest={index === 0} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};
