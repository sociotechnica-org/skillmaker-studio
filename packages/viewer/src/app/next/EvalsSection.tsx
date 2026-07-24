/**
 * The claim-first Evals tree (IA doc §C): claims are the rows, grouped by
 * family; fixtures hang under claims (accordion, lazily fetched); runs hang
 * under fixtures; run detail nests INLINE (skill → evals → fixture → run,
 * never a modal). Model is a column (per-model status chips), version is a
 * pivot (latest vs all), and a claim without a fixture mints a task.
 *
 * Everything rides EXISTING endpoints: the tree's spine comes from the one
 * bundle-detail fetch (`page.evals`); fixture prompts (`GET /fixtures/:case`),
 * run glances (`GET /runs/:runId`, for the invoked chip) and run responses
 * (`GET /file?path=runs/<id>/response.md`) are fetched lazily on expand and
 * cached per slug-mount. Without a server (`page.evals === null`) the
 * section renders the placeholder claims, inert -- never broken.
 */
import { useState } from "react";
import { FileContentView } from "../components/Markdown.tsx";
import { postEvent } from "../runtime/api.ts";
import { fetchBundleFile, fetchFixtureGlance, fetchRunGlance } from "./api.ts";
import type { FixtureGlance, RunGlance } from "./api.ts";
import {
  buildGapTodoPayload,
  bundleModels,
  claimStatusInScope,
  groupClaimsByFamily,
  modelChipsForClaim,
  runAllButtonLabel,
  runsForFixture,
} from "./evals.ts";
import { useRunDispatch } from "./runsApi.ts";
import type { ModelChip, ModelChipStatus, VersionScope } from "./evals.ts";
import { Button, CLAIM_DOT, FADE_R } from "./ui.tsx";
import type { Claim, EvalRun, EvalsData, SkillPage } from "./types.ts";

/** Newest runs shown per fixture -- older ones are counted, not listed. */
const RUN_CAP = 8;

/** A lazy fetch's three honest states -- loading and error render quiet, never as data. */
type Lazy<T> = { readonly state: "loading" } | { readonly state: "ready"; readonly value: T } | { readonly state: "error" };

const CHIP_CLASS: Record<ModelChipStatus, string> = {
  proven: "bg-emerald-100 text-emerald-800",
  failing: "bg-rose-100 text-rose-800",
  stale: "bg-amber-100 text-amber-800",
  unmeasured: "border border-border text-ink-muted",
};

const CHIP_MARK: Record<ModelChipStatus, string> = {
  proven: "●",
  failing: "✕",
  stale: "◔",
  unmeasured: "◌",
};

const VERDICT_CLASS: Record<string, string> = {
  pass: "bg-emerald-100 text-emerald-800",
  fail: "bg-rose-100 text-rose-800",
  partial: "bg-amber-100 text-amber-800",
};

function ModelChips({ chips }: { readonly chips: ReadonlyArray<ModelChip> }) {
  return (
    <span className="flex shrink-0 gap-1">
      {chips.map((chip) => (
        <span
          key={chip.model}
          title={`${chip.model}: ${chip.status}`}
          className={`rounded px-1 text-[10px] ${CHIP_CLASS[chip.status]}`}
        >
          {CHIP_MARK[chip.status]} {chip.model}
        </span>
      ))}
    </span>
  );
}

/** IA §C rule 3's epistemic core: skill exercised vs model-default behavior. Renders nothing until the run's glance has answered. */
function InvokedChip({ glance }: { readonly glance: Lazy<RunGlance> | undefined }) {
  if (glance === undefined || glance.state !== "ready" || glance.value.skillInvoked === null) return null;
  return glance.value.skillInvoked ? (
    <span className="rounded bg-sky-100 px-1 text-[10px] text-sky-800" title="Transcript shows the skill was exercised">
      invoked
    </span>
  ) : (
    <span className="rounded bg-rose-100 px-1 text-[10px] text-rose-800" title="No evidence the skill was exercised — model-default behavior">
      not invoked
    </span>
  );
}

const shortHash = (hash: string): string => hash.replace(/^sha256:/, "").slice(0, 8);

const runStartedLabel = (startedAt: string): string => {
  const date = new Date(startedAt);
  return Number.isNaN(date.getTime())
    ? startedAt
    : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function EvalsSection({ page }: { readonly page: SkillPage }) {
  const evals = page.evals;
  const [scope, setScope] = useState<VersionScope>("latest");
  const [expandedClaims, setExpandedClaims] = useState<ReadonlySet<string>>(new Set());
  const [expandedRuns, setExpandedRuns] = useState<ReadonlySet<string>>(new Set());
  const [fixtureGlances, setFixtureGlances] = useState<Readonly<Record<string, Lazy<FixtureGlance>>>>({});
  const [runGlances, setRunGlances] = useState<Readonly<Record<string, Lazy<RunGlance>>>>({});
  const [runResponses, setRunResponses] = useState<Readonly<Record<string, Lazy<string | null>>>>({});
  const [queuedGaps, setQueuedGaps] = useState<ReadonlySet<string>>(new Set());
  const [mintingGaps, setMintingGaps] = useState<ReadonlySet<string>>(new Set());
  const [gapErrors, setGapErrors] = useState<Readonly<Record<string, string>>>({});

  const models = evals === null ? [] : bundleModels(evals.measurements);

  // Fixture-run dispatch (same engine as `skillmaker run`): inert without a
  // server. `anyActive` disables "Run all" -- the server 409s a busy bundle.
  const runs = useRunDispatch(evals?.slug ?? "");
  const anyActive = runs.activeFixtures.size > 0 || runs.runAll !== null;

  const ensureFixtureGlance = (data: EvalsData, caseName: string): void => {
    setFixtureGlances((current) => {
      if (current[caseName] !== undefined) return current;
      fetchFixtureGlance(data.slug, caseName).then(
        (value) => setFixtureGlances((c) => ({ ...c, [caseName]: { state: "ready", value } })),
        () => setFixtureGlances((c) => ({ ...c, [caseName]: { state: "error" } })),
      );
      return { ...current, [caseName]: { state: "loading" } };
    });
  };

  const ensureRunGlance = (data: EvalsData, runId: string): void => {
    setRunGlances((current) => {
      if (current[runId] !== undefined) return current;
      fetchRunGlance(data.slug, runId).then(
        (value) => setRunGlances((c) => ({ ...c, [runId]: { state: "ready", value } })),
        () => setRunGlances((c) => ({ ...c, [runId]: { state: "error" } })),
      );
      return { ...current, [runId]: { state: "loading" } };
    });
  };

  const ensureRunResponse = (data: EvalsData, runId: string): void => {
    setRunResponses((current) => {
      if (current[runId] !== undefined) return current;
      fetchBundleFile(data.slug, `runs/${runId}/response.md`).then(
        (content) => setRunResponses((c) => ({ ...c, [runId]: { state: "ready", value: content } })),
        // A 404 here is the common honest case: the run captured no response.md.
        () => setRunResponses((c) => ({ ...c, [runId]: { state: "ready", value: null } })),
      );
      return { ...current, [runId]: { state: "loading" } };
    });
  };

  const toggleClaim = (claim: Claim): void => {
    const opening = !expandedClaims.has(claim.id);
    setExpandedClaims((current) => {
      const next = new Set(current);
      if (next.has(claim.id)) next.delete(claim.id);
      else next.add(claim.id);
      return next;
    });
    if (opening && evals !== null) {
      for (const caseName of claim.fixtureCases) {
        ensureFixtureGlance(evals, caseName);
        // Prefetch the visible runs' glances so their invoked chips can
        // answer -- the flag lives only on `GET /runs/:runId`.
        for (const run of runsForFixture(evals.runs, caseName).slice(0, RUN_CAP)) {
          ensureRunGlance(evals, run.id);
        }
      }
    }
  };

  const toggleRun = (runId: string): void => {
    const opening = !expandedRuns.has(runId);
    setExpandedRuns((current) => {
      const next = new Set(current);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
    if (opening && evals !== null) {
      ensureRunGlance(evals, runId);
      ensureRunResponse(evals, runId);
    }
  };

  const mintGapTodo = (claim: Claim): void => {
    if (evals === null || mintingGaps.has(claim.id) || queuedGaps.has(claim.id)) return;
    const payload = buildGapTodoPayload({
      riskId: claim.id,
      sentence: claim.sentence,
      bundle: evals.slug,
      id: `td-${crypto.randomUUID()}`,
      created: new Date().toISOString().slice(0, 10),
    });
    setMintingGaps((current) => new Set(current).add(claim.id));
    setGapErrors(({ [claim.id]: _dropped, ...rest }) => rest);
    postEvent({ type: "todo.opened", payload: { todo: payload.todo } })
      .then((result) => {
        if (result.ok) {
          setQueuedGaps((current) => new Set(current).add(claim.id));
        } else {
          setGapErrors((current) => ({ ...current, [claim.id]: result.error }));
        }
      })
      .catch((cause: Error) => setGapErrors((current) => ({ ...current, [claim.id]: cause.message })))
      .finally(() =>
        setMintingGaps((current) => {
          const next = new Set(current);
          next.delete(claim.id);
          return next;
        }),
      );
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        {evals === null ? (
          <span />
        ) : (
          // Rule 5: version is a pivot, not a level -- one small control
          // filtering which measurements count for statuses and chips.
          <div className="flex items-center gap-1 text-xs">
            <span className="text-ink-muted">Version:</span>
            {(
              [
                {
                  id: "latest" as const,
                  label: evals.latestVersionHash === null ? "Latest (none recorded)" : `Latest ${shortHash(evals.latestVersionHash)}`,
                },
                { id: "all" as const, label: "All versions" },
              ]
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setScope(option.id)}
                className={`rounded-full px-2 py-0.5 font-display ${
                  scope === option.id ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex shrink-0 gap-2">
          <Button label="New claim" />
          <Button
            label={runAllButtonLabel(runs.runAll, runs.activeFixtures.size)}
            primary
            disabled={evals === null || anyActive}
            onClick={runs.runAllFixtures}
          />
        </div>
      </div>
      {runs.error !== null && <p className="pt-1 text-right text-xs text-rose-700">{runs.error}</p>}

      <div className="mt-1 space-y-2">
        {groupClaimsByFamily(page.claims).map((group) => (
          <div key={group.family}>
            <div className="pt-1 font-display text-[10px] uppercase tracking-wide text-ink-muted">{group.family}</div>
            <div className="mt-1 space-y-1">
              {group.claims.map((claim) => {
                const chips =
                  evals === null
                    ? []
                    : modelChipsForClaim({
                        measurements: evals.measurements,
                        fixtureCases: claim.fixtureCases,
                        scope,
                        latestVersionHash: evals.latestVersionHash,
                        models,
                      });
                const status = evals === null ? claim.status : claimStatusInScope(claim.status, chips);
                const expanded = expandedClaims.has(claim.id);
                return (
                  <div key={claim.id} className="rounded border border-border bg-surface px-3 py-2 shadow-sm">
                    <div className="flex items-center gap-2 text-sm">
                      <span title={status}>{CLAIM_DOT[status]}</span>
                      <span className={`min-w-0 flex-1 ${FADE_R}`}>{claim.sentence}</span>
                      {chips.length > 0 && <ModelChips chips={chips} />}
                      <span className="font-mono text-[10px] text-ink-muted">{claim.id}</span>
                      <span className="rounded bg-neutral-100 px-1.5 text-[10px] text-ink-muted dark:bg-neutral-800">{status}</span>
                    </div>
                    <div className="pl-6 text-xs text-ink-muted">
                      {claim.fixtures > 0 ? (
                        evals === null ? (
                          `${claim.fixtures} fixture${claim.fixtures === 1 ? "" : "s"} · expand ▸`
                        ) : (
                          <button type="button" onClick={() => toggleClaim(claim)} className="hover:text-ink">
                            {claim.fixtures} fixture{claim.fixtures === 1 ? "" : "s"} · {expanded ? "collapse ▾" : "expand ▸"}
                          </button>
                        )
                      ) : queuedGaps.has(claim.id) ? (
                        <span className="text-emerald-700">queued ✓</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => mintGapTodo(claim)}
                            title="Mints a task"
                            className="underline hover:text-ink disabled:opacity-60"
                            disabled={evals === null || mintingGaps.has(claim.id)}
                          >
                            {mintingGaps.has(claim.id) ? "queueing…" : "no fixture — add to Tasks"}
                          </button>
                          {gapErrors[claim.id] !== undefined && (
                            <span className="pl-2 text-rose-700">{gapErrors[claim.id]}</span>
                          )}
                        </>
                      )}
                    </div>
                    {expanded && evals !== null && (
                      <div className="mt-2 space-y-2 border-l border-border pl-4">
                        {claim.fixtureCases.map((caseName) => (
                          <FixtureBlock
                            key={caseName}
                            caseName={caseName}
                            running={runs.activeFixtures.has(caseName)}
                            onRun={() => runs.runFixture(caseName)}
                            glance={fixtureGlances[caseName]}
                            runs={runsForFixture(evals.runs, caseName)}
                            runGlances={runGlances}
                            runResponses={runResponses}
                            expandedRuns={expandedRuns}
                            onToggleRun={toggleRun}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {evals !== null && evals.unclaimed.length > 0 && (
        <p className="pt-2 text-xs text-ink-muted">
          Unclaimed fixtures — evidence without a claim: <span className="font-mono">{evals.unclaimed.join(", ")}</span>
        </p>
      )}
    </section>
  );
}

function FixtureBlock({
  caseName,
  running,
  onRun,
  glance,
  runs,
  runGlances,
  runResponses,
  expandedRuns,
  onToggleRun,
}: {
  readonly caseName: string;
  /** True while this fixture has a dispatched run in flight (running or queued). */
  readonly running: boolean;
  readonly onRun: () => void;
  readonly glance: Lazy<FixtureGlance> | undefined;
  readonly runs: ReadonlyArray<EvalRun>;
  readonly runGlances: Readonly<Record<string, Lazy<RunGlance>>>;
  readonly runResponses: Readonly<Record<string, Lazy<string | null>>>;
  readonly expandedRuns: ReadonlySet<string>;
  readonly onToggleRun: (runId: string) => void;
}) {
  const shown = runs.slice(0, RUN_CAP);
  const older = runs.length - shown.length;
  return (
    <div>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-ink">{caseName}</span>
        {running ? (
          <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800">running…</span>
        ) : (
          <button
            type="button"
            onClick={onRun}
            title={`Run fixture ${caseName} (same engine as skillmaker run)`}
            className="rounded border border-border px-1 text-[10px] text-ink-muted hover:text-ink"
          >
            ▸ Run
          </button>
        )}
        {glance !== undefined && glance.state === "ready" && (
          <>
            {glance.value.fixtureClass !== null && (
              <span className="rounded bg-neutral-100 px-1 text-[10px] text-ink-muted dark:bg-neutral-800">{glance.value.fixtureClass}</span>
            )}
            {glance.value.hasAnswerKey ? (
              <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-800" title="case.json carries an answer key">
                answer key
              </span>
            ) : (
              <span className="rounded border border-border px-1 text-[10px] text-ink-muted" title="No answer key authored yet">
                no answer key
              </span>
            )}
            {glance.value.checkCount > 0 && (
              <span className="text-[10px] text-ink-muted">
                {glance.value.checkCount} check{glance.value.checkCount === 1 ? "" : "s"}
              </span>
            )}
          </>
        )}
        {glance !== undefined && glance.state === "error" && (
          <span className="text-[10px] text-rose-700">fixture unreadable</span>
        )}
      </div>
      <div className={`text-xs text-ink-muted ${FADE_R}`}>
        {glance === undefined || glance.state === "loading"
          ? "Loading fixture…"
          : glance.state === "error"
            ? ""
            : glance.value.summary ?? "(no prompt authored)"}
      </div>

      {shown.length === 0 ? (
        <p className="pt-1 text-[11px] text-ink-muted">No runs yet.</p>
      ) : (
        <div className="mt-1 space-y-1">
          {shown.map((run) => {
            const expanded = expandedRuns.has(run.id);
            return (
              <div key={run.id}>
                <button
                  type="button"
                  onClick={() => onToggleRun(run.id)}
                  className="flex w-full items-center gap-2 rounded bg-paper px-2 py-1 text-left text-[11px] hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="shrink-0 text-ink-muted">{expanded ? "▾" : "▸"}</span>
                  <span className="shrink-0 text-ink-muted">{runStartedLabel(run.startedAt)}</span>
                  <span className={`min-w-0 flex-1 ${FADE_R}`}>
                    {run.provider} · {run.model}
                  </span>
                  <span className="shrink-0 text-ink-muted">{run.status}</span>
                  {run.verdict !== null && (
                    <span className={`shrink-0 rounded px-1 text-[10px] ${VERDICT_CLASS[run.verdict] ?? ""}`}>{run.verdict}</span>
                  )}
                  <InvokedChip glance={runGlances[run.id]} />
                </button>
                {expanded && (
                  <RunDetailBlock
                    run={run}
                    glance={runGlances[run.id]}
                    response={runResponses[run.id]}
                  />
                )}
              </div>
            );
          })}
          {older > 0 && <p className="text-[10px] text-ink-muted">+{older} older run{older === 1 ? "" : "s"}</p>}
        </div>
      )}
    </div>
  );
}

/** Rule: run detail nests inline (skill → evals → fixture → run), never a modal. Minimal: identity line, response.md, artifact names. */
function RunDetailBlock({
  run,
  glance,
  response,
}: {
  readonly run: EvalRun;
  readonly glance: Lazy<RunGlance> | undefined;
  readonly response: Lazy<string | null> | undefined;
}) {
  const artifacts =
    glance !== undefined && glance.state === "ready"
      ? glance.value.artifacts.filter((a) => !a.endsWith("response.md"))
      : [];
  return (
    <div className="ml-4 mt-1 rounded border border-border bg-paper p-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-muted">
        <span className="font-mono">{run.id}</span>
        <span>version {shortHash(run.versionHash)}</span>
        {glance !== undefined && glance.state === "error" && <span className="text-rose-700">run detail unreadable</span>}
      </div>
      <div className="pt-1">
        {response === undefined || response.state === "loading" ? (
          <p className="text-[11px] text-ink-muted">Loading response…</p>
        ) : response.state === "error" || response.value === null ? (
          <p className="text-[11px] text-ink-muted">No response captured.</p>
        ) : (
          <FileContentView
            path="response.md"
            content={response.value}
            preClassName="max-h-60 overflow-auto rounded bg-surface p-2 font-mono text-[11px]"
            renderedClassName="max-h-60 overflow-auto rounded border border-border bg-surface p-2"
          />
        )}
      </div>
      {artifacts.length > 0 && (
        <p className="pt-1 text-[10px] text-ink-muted">
          Artifacts: <span className="font-mono">{artifacts.join(", ")}</span>
        </p>
      )}
      <GradePanel run={run} />
    </div>
  );
}

/**
 * Grading, in the shell (the old app's run modal was the only grading
 * surface; the root swap retires it). Honest regrade framing per the #22
 * ruling: a graded run never presents as ungraded — the current verdict
 * leads and the action reads as a regrade. Every submission is a new
 * `run.graded` event; the fold keeps history, latest wins.
 */
function GradePanel({ run }: { readonly run: EvalRun }) {
  const [verdict, setVerdict] = useState<"pass" | "fail" | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = (v: "pass" | "fail") => {
    setVerdict(v);
    setPending(true);
    setError(null);
    const payload: Record<string, unknown> = {
      id: run.id,
      verdict: v,
      ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
    };
    postEvent({ type: "run.graded", payload })
      .then((result) => {
        if (!result.ok) setError(result.error);
        else setDone(true);
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setPending(false));
  };

  const graded = run.verdict !== null;
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-ink-muted">
          {done && verdict !== null
            ? `Graded: ${verdict}`
            : graded
              ? `Graded: ${run.verdict} —`
              : "Grade this run:"}
        </span>
        {!done && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => submit("pass")}
              className="rounded border border-border bg-surface px-2 py-0.5 font-display hover:bg-emerald-50 disabled:opacity-50"
            >
              {graded ? "Regrade pass" : "Pass"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => submit("fail")}
              className="rounded border border-border bg-surface px-2 py-0.5 font-display hover:bg-rose-50 disabled:opacity-50"
            >
              {graded ? "Regrade fail" : "Fail"}
            </button>
            <input
              className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-0.5 text-[11px] outline-none focus:border-amber-300"
              placeholder="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </>
        )}
      </div>
      {error !== null && <p className="pt-1 text-[10px] text-rose-700">{error}</p>}
    </div>
  );
}
