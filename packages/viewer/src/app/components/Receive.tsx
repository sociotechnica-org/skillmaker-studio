/**
 * The `/receive` page (#72, Board · Lab · Ship · Receive · Activity): the
 * receiving bay -- "what the wild sends back." Ship's outbound half of the
 * checkout/return-record primitive (`Vision - Board Lab Ship Receive.md`
 * §HOW) has a manifest (`skill.shipped`, #66); this is where its inbound
 * half lands (issue #67): a workspace-wide field-report list, newest first,
 * plus a minimal paste form -- "even a manually pasted field report proves
 * the loop closes once, by hand, before automating it." The list is read via
 * `GET /api/field-reports` (`useFieldReports`), the form writes through the
 * generic `POST /api/events` path (`postEvent`), same as `TodosPanel`.
 *
 * The harvest affordance (issue #68) closes the loop visibly, CLI-first --
 * no write button in this pass: a harvested report (`fixtureCase !== null`)
 * links to its fixture on the bundle's Evals tab; an unharvested
 * `failed`/`surprise` report shows `skillmaker fixture harvest`'s command as
 * copyable text instead, `<case>` left for the human to name.
 *
 * The todo affordance (issue #81) is the second exit door, independent of
 * the first: a report with a linked todo (`todo !== null`) shows a work
 * chip (title + status); an unharvested `failed`/`surprise` report with no
 * linked todo shows `skillmaker todo add --from-report`'s command as
 * copyable text next to the harvest command -- CLI-first, no write button,
 * matching #68 exactly. The two doors are independent: a report can be
 * harvested into a fixture AND turned into a todo, either, or neither.
 */
import { type FC, type FormEvent, type ReactNode, useState } from "react";
import { postEvent } from "../runtime/api.ts";
import { bundleHref, shipBundleHref, Link } from "../runtime/router.tsx";
import type { FieldReportOutcome, FieldReportView, TodoStatus } from "../runtime/schemas.ts";
import { useBundles } from "../runtime/useBundles.ts";
import { useFieldReports } from "../runtime/useFieldReports.ts";

/** Report outcomes worth harvesting -- a "worked" report has no failure to turn into a fixture or work. */
const HARVESTABLE_OUTCOMES: ReadonlyArray<FieldReportOutcome> = ["failed", "surprise"];

const harvestCommand = (report: FieldReportView): string =>
  `skillmaker fixture harvest ${report.bundle} <case> --from-report ${report.id}`;

const todoAddCommand = (report: FieldReportView): string => `skillmaker todo add "<title>" --from-report ${report.id}`;

/** Keyed by the actual union (not a loose `string`) so a new `TodoStatus` literal fails to compile here, same discipline as `OUTCOME_BADGE_CLASS` below. */
const TODO_STATUS_LABEL: Readonly<Record<TodoStatus, string>> = {
  open: "open",
  "in-progress": "in progress",
  done: "done",
  "wont-do": "won't do",
};

const OUTCOMES: ReadonlyArray<FieldReportOutcome> = ["worked", "failed", "surprise"];

const OUTCOME_BADGE_CLASS: Readonly<Record<FieldReportOutcome, string>> = {
  worked: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  surprise: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const shortHash = (hash: string): string => {
  const prefix = "sha256:";
  return (hash.startsWith(prefix) ? hash.slice(prefix.length) : hash).slice(0, 12);
};

/**
 * One "exit door" out of a report row (issue #68's harvest link, issue
 * #81's todo chip): `linked` when the report already has one, otherwise the
 * copyable CLI command, and nothing at all for an unharvestable `worked`
 * report. Both doors share this shape; only what fills it differs.
 */
const ExitDoor: FC<{ linked: ReactNode | null; outcome: FieldReportOutcome; command: string }> = ({
  linked,
  outcome,
  command,
}) => {
  if (linked !== null) {
    return linked;
  }
  if (!HARVESTABLE_OUTCOMES.includes(outcome)) {
    return null;
  }
  return (
    <code className="w-fit select-all rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
      {command}
    </code>
  );
};

const ReportRow: FC<{ report: FieldReportView }> = ({ report }) => (
  <li className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={shipBundleHref(report.bundle)}
        className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
      >
        {report.bundle}
      </Link>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${OUTCOME_BADGE_CLASS[report.outcome]}`}>
        {report.outcome}
      </span>
    </div>
    <p className="text-sm text-neutral-700 dark:text-neutral-300">{report.report}</p>
    <div className="flex flex-wrap gap-3 text-xs text-neutral-500 dark:text-neutral-400">
      {report.versionHash !== null && <span className="font-mono">{shortHash(report.versionHash)}</span>}
      {report.destination !== null && <span>from "{report.destination}"</span>}
      <span>{new Date(report.at).toLocaleString()}</span>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <ExitDoor
        linked={
          report.fixtureCase !== null ? (
            <Link
              href={bundleHref(report.bundle, "evals")}
              className="w-fit text-xs font-medium text-neutral-700 hover:underline dark:text-neutral-300"
            >
              harvested → {report.fixtureCase} (Evals)
            </Link>
          ) : null
        }
        outcome={report.outcome}
        command={harvestCommand(report)}
      />
      <ExitDoor
        linked={
          report.todo !== null ? (
            <span className="w-fit rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              work: {report.todo.title} · {TODO_STATUS_LABEL[report.todo.status]}
            </span>
          ) : null
        }
        outcome={report.outcome}
        command={todoAddCommand(report)}
      />
    </div>
  </li>
);

/** The minimal paste form (issue #67): bundle select + outcome select + textarea -- "the manually pasted channel, verbatim." */
const ReportForm: FC<{ onReported: () => void }> = ({ onReported }) => {
  const { bundles } = useBundles();
  const [bundle, setBundle] = useState("");
  const [outcome, setOutcome] = useState<FieldReportOutcome>("worked");
  const [report, setReport] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const text = report.trim();
    if (bundle.length === 0 || text.length === 0) {
      return;
    }
    setPending(true);
    setError(undefined);
    postEvent({ type: "skill.field_report", payload: { bundle, outcome, report: text } })
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setReport("");
        onReported();
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Paste a field report
      </h2>
      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <select
          value={bundle}
          onChange={(event) => setBundle(event.target.value)}
          className="flex-1 rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        >
          <option value="">Select a bundle...</option>
          {bundles.map((candidate) => (
            <option key={candidate.slug} value={candidate.slug}>
              {candidate.slug}
            </option>
          ))}
        </select>
        <select
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as FieldReportOutcome)}
          className="flex-1 rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        >
          {OUTCOMES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={report}
        onChange={(event) => setReport(event.target.value)}
        placeholder="What happened in the wild?"
        rows={3}
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />
      <button
        type="submit"
        disabled={pending || bundle.length === 0 || report.trim().length === 0}
        className="w-fit rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {pending ? "Recording..." : "+ Add field report"}
      </button>
    </form>
  );
};

/** The `/receive` index page: a paste form plus the workspace-wide field-report list, newest first. */
export const Receive: FC = () => {
  const { reports, loading, error, refetch } = useFieldReports();

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Receive</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          the receiving bay — what the wild sends back.
        </p>
      </div>

      <ReportForm onReported={refetch} />

      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load field reports: {error.message}
        </p>
      )}

      {loading && reports.length === 0 && error === undefined && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
      )}

      {reports.length === 0 && !loading ? (
        <p className="text-sm text-neutral-400">
          Nothing here yet. Field reports about shipped skills land here once pasted above — a skill that fails in
          the wild is a new fixture.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} />
          ))}
        </ul>
      )}
    </div>
  );
};
