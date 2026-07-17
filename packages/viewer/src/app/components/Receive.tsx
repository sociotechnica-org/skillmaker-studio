/**
 * The `/receive` page (#72, Board · Lab · Ship · Receive · Activity): the
 * receiving bay -- "what the wild sends back." Ship's outbound half of the
 * checkout/return-record primitive (`Vision - Board Lab Ship Receive.md`
 * §HOW) has a manifest (`skill.shipped`, #66); this is where its inbound
 * half lands (issue #67): a workspace-wide field-report list, newest first,
 * plus a minimal paste form -- "even a manually pasted field report proves
 * the loop closes once, by hand, before automating it." The list is read via
 * `GET /api/field-reports` (`useFieldReports`), the form writes through the
 * generic `POST /api/events` path (`postEvent`), same as the Lab's Queue
 * mode (`Queue.tsx`, formerly `TodosPanel`).
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
 *
 * The Intake section (issue #90, `Mechanism - Receiving Dock.md`) is the
 * OTHER cargo arriving here -- skills themselves, not signal about a shipped
 * skill: `skillmaker receive <path>` is the only door for RECEIVING a crate
 * (CLI-first, no write button here either -- "the CLI flags are the form for
 * now"), and this section reads `GET /api/intake`'s undisposed crates,
 * oldest first ("the dock must not become a shelf: oldest-first IS the
 * attention ordering"), each with its verdict recomputed server-side on
 * every request.
 *
 * The five exit doors (issue #91) follow the exact same CLI-first pattern
 * as harvest/todo above: no write buttons, each undisposed crate row shows
 * the doors its verdict offers (`VERDICT_DISPOSITIONS`) as copyable
 * `skillmaker route` commands, pre-filled with the
 * intake id and (where the disposition needs one) a `<bundle>`/`<parent>`
 * placeholder for the human to fill in -- resolving WHICH bundle a
 * `return`/`conflict` verdict specifically points at would need per-bundle
 * plumbing beyond the workspace-wide registry set `GET /api/intake` already
 * computes, so that's left as a human fill-in, same as harvest's `<case>`/
 * todo's `<title>` placeholders. The door(s) matching the crate's OWN
 * verdict are visually distinguished as "the verdict's suggestion" --
 * `new`/`return` verdicts suggest exactly one door; `conflict` (the
 * identically-labeled stranger) suggests the three judgment calls
 * (`upgrade`/`fork`/`salvage`), since a hash+name overlap with different
 * content is precisely the case a human, not the dock, must rule on. Once
 * disposed, a crate leaves this list; `GET /api/intake`'s `recentlyRouted`
 * tail (below) is where its disposition + reason still show, so a routed
 * crate doesn't vanish without a trace.
 */
import { type FC, type FormEvent, type ReactNode, useState } from "react";
import { postEvent } from "../runtime/api.ts";
import { bundleHref, shipBundleHref, Link } from "../runtime/router.tsx";
import {
  UNVERIFIED_BADGE_CLASS,
  VERDICT_DISPOSITIONS,
  type FieldReportOutcome,
  type FieldReportView,
  type IntakeCrateView,
  type IntakeVerdict,
  type RecentlyRoutedView,
  type RouteDisposition,
  type TodoStatus,
} from "../runtime/schemas.ts";
import { useBundles } from "../runtime/useBundles.ts";
import { useFieldReports } from "../runtime/useFieldReports.ts";
import { useIntake } from "../runtime/useIntake.ts";

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
              href={bundleHref(report.bundle, "models")}
              className="w-fit text-xs font-medium text-neutral-700 hover:underline dark:text-neutral-300"
            >
              harvested → {report.fixtureCase} (Models)
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

/** Verdict chip colors (issue #90): `conflict` is loud -- the identically-labeled stranger is the one case that needs a human's attention first. */
const VERDICT_BADGE_CLASS: Readonly<Record<IntakeVerdict, string>> = {
  conflict: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  return: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  new: "bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
};

/** The dock verdict's suggested door(s) (issue #91): `return`/`new` each point at exactly one door; `conflict` (the identically-labeled stranger) is precisely the case the dock CANNOT resolve on its own, so it suggests the three human judgment calls instead. A strict subset of `VERDICT_DISPOSITIONS` (schemas.ts), which additionally offers `salvage` -- the universal refusal door -- under every verdict. */
const SUGGESTED_DISPOSITIONS: Readonly<Record<IntakeVerdict, ReadonlyArray<RouteDisposition>>> = {
  return: ["return"],
  new: ["new"],
  conflict: ["upgrade", "fork", "salvage"],
};

/** One `skillmaker route` command per disposition, pre-filled with the intake id -- `<bundle>`/`<parent>`/`<name>` are left as human fill-ins, same convention as harvest's `<case>`/todo's `<title>` placeholders elsewhere on this page. */
const routeCommand = (intake: string, disposition: RouteDisposition): string => {
  switch (disposition) {
    case "return":
      return `skillmaker route ${intake} --as return --bundle <slug> --reason "<why>"`;
    case "new":
      return `skillmaker route ${intake} --as new --reason "<why>"`;
    case "upgrade":
      return `skillmaker route ${intake} --as upgrade --bundle <slug> --reason "<why>"`;
    case "fork":
      return `skillmaker route ${intake} --as fork --parent <slug> --reason "<why>"`;
    case "salvage":
      return `skillmaker route ${intake} --as salvage --reason "<why>"`;
  }
};

/**
 * The doors the crate's verdict offers (`VERDICT_DISPOSITIONS`), each a
 * copyable `skillmaker route` command; the door(s) matching the verdict's
 * own suggestion are visually distinguished. Off-menu rulings stay possible
 * through the CLI (which prints an advisory, never a gate) -- the registry
 * can't see everything a human can, e.g. a heavily rewritten fork shares no
 * hash or name with its parent.
 */
const RouteDoors: FC<{ crate: IntakeCrateView }> = ({ crate }) => {
  const suggested = new Set(SUGGESTED_DISPOSITIONS[crate.verdict]);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Route this crate
      </span>
      <ul className="flex flex-col gap-1">
        {VERDICT_DISPOSITIONS[crate.verdict].map((disposition) => (
          <li key={disposition} className="flex items-center gap-2">
            <code
              className={`w-fit select-all rounded-md px-2 py-1 text-[11px] ${
                suggested.has(disposition)
                  ? "bg-neutral-900 text-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
              }`}
            >
              {routeCommand(crate.intake, disposition)}
            </code>
            {suggested.has(disposition) && (
              <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">suggested</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

/** One undisposed crate at the dock: claims verbatim, the verdict recomputed server-side, an "unclear rights" flag when present -- recorded, never a gate. Structured stakes/hurts testimony (issue #108) surfaces here too; old crates' flattened `notes` prose stays displayed as-is, never re-parsed. */
const CrateRow: FC<{ crate: IntakeCrateView }> = ({ crate }) => (
  <li className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {crate.claimedName ?? "unnamed crate"}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${VERDICT_BADGE_CLASS[crate.verdict]}`}>
        {crate.verdict}
      </span>
      {crate.rights === "unclear" && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          unclear rights
        </span>
      )}
      {crate.stakes !== null && (
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          {crate.stakes}
        </span>
      )}
    </div>
    <div className="flex flex-wrap gap-3 text-xs text-neutral-500 dark:text-neutral-400">
      <span>from &quot;{crate.source}&quot;</span>
      {crate.ref !== null && <span>@ {crate.ref}</span>}
      {crate.claimedVersionHash !== null && <span className="font-mono">claims {crate.claimedVersionHash}</span>}
      <span>{new Date(crate.at).toLocaleString()}</span>
    </div>
    {crate.hurts !== null && (
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        <span className="font-medium text-neutral-500 dark:text-neutral-400">Hurts: </span>
        {crate.hurts}
      </p>
    )}
    {crate.notes !== null && <p className="text-sm text-neutral-700 dark:text-neutral-300">{crate.notes}</p>}
    <code className="w-fit select-all rounded-md bg-neutral-100 px-2 py-1 text-[11px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
      {crate.intake}
    </code>
    <RouteDoors crate={crate} />
  </li>
);

/** One recently routed crate (issue #91): the disposition + reason a disposed crate left with, after it leaves `crates` above -- the "recently routed" tail so a routed crate doesn't vanish without a trace. Carries the Unverified badge (issue #93) while it holds. */
const RecentlyRoutedRow: FC<{ routed: RecentlyRoutedView }> = ({ routed }) => (
  <li className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {routed.claimedName ?? "unnamed crate"}
      </span>
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        {routed.disposition}
      </span>
      {routed.bundle !== null && (
        <Link
          href={bundleHref(routed.bundle)}
          className="text-xs font-medium text-neutral-700 hover:underline dark:text-neutral-300"
        >
          {routed.bundle}
        </Link>
      )}
      {routed.unverified && (
        <span
          title="Arrived from outside; we have not yet measured it."
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${UNVERIFIED_BADGE_CLASS}`}
        >
          Unverified
        </span>
      )}
    </div>
    <p className="text-xs text-neutral-500 dark:text-neutral-400">{routed.reason}</p>
    <span className="text-[11px] text-neutral-400">{new Date(routed.at).toLocaleString()}</span>
  </li>
);

/**
 * The Intake section (issue #90): `GET /api/intake`'s undisposed crates,
 * oldest first -- no write button here, `skillmaker receive <path>` is the
 * only door for now. The empty state names the actual job the section does
 * ("undisposed, oldest first, until a human routes them"), not a generic
 * "nothing here yet."
 */
const IntakeSection: FC = () => {
  const { crates, recentlyRouted, loading, error } = useIntake();

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Intake — the dock
      </h2>

      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load intake: {error.message}
        </p>
      )}

      {loading && crates.length === 0 && error === undefined && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
      )}

      {crates.length === 0 && !loading ? (
        <p className="text-sm text-neutral-400">
          Nothing at the dock. Arriving skills land here via <code>skillmaker receive &lt;path&gt;</code> —
          undisposed, oldest first, until a human routes them.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {crates.map((crate) => (
            <CrateRow key={crate.intake} crate={crate} />
          ))}
        </ul>
      )}

      {recentlyRouted.length > 0 && (
        <div className="flex flex-col gap-2 pt-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            Recently routed
          </h3>
          <ul className="flex flex-col gap-2">
            {recentlyRouted.map((routed) => (
              <RecentlyRoutedRow key={routed.intake} routed={routed} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

/** The `/receive` index page: the Intake dock queue, a paste form, and the workspace-wide field-report list, newest first. */
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

      <IntakeSection />

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
