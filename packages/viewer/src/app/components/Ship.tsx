/**
 * The `/ship` page (#72, Board · Lab · Ship · Receive · Activity): the
 * shipping bay -- "skills leave with receipts." An index of every bundle
 * (name, one-liner, stage, latest version, measurements summary) plus
 * per-bundle chapters (`/ship/:slug`) rendering the same data `skillmaker
 * book build` renders to a static site -- design.md, measurement receipts,
 * and a journal changelog. That per-bundle chapter is still the
 * *Skillbook* -- the paperwork that ships with a skill, not the surface it
 * left through (`SkillbookBundlePage` below keeps its name for exactly
 * that reason). Split out of the old two-job `Port` (#64); Receive
 * (`Receive.tsx`) now owns the inbound half. Reuses `Lab.tsx`'s
 * stage-badge patterns.
 */
import type { FC } from "react";
import { Link, shipBundleHref, useRouter } from "../runtime/router.tsx";
import type { SkillbookBundle } from "../runtime/schemas.ts";
import { useSkillbook } from "../runtime/useSkillbook.ts";

const STAGE_BADGE_CLASS: Record<string, string> = {
  idea: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  researching: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  drafting: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  evaluating: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

const stageBadgeClass = (stage: string): string =>
  STAGE_BADGE_CLASS[stage] ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";

const shortHash = (hash: string): string => {
  const prefix = "sha256:";
  return (hash.startsWith(prefix) ? hash.slice(prefix.length) : hash).slice(0, 12);
};

/** "Shipped 2x -- last to acme-fleet" (issue #66): only shown when at least one shipment exists -- Ship's index-row signal of what's out in the world. */
const shippingLine = (bundle: SkillbookBundle): string | undefined => {
  if (bundle.shipments.length === 0) {
    return undefined;
  }
  const last = bundle.shipments[0];
  const count = bundle.shipments.length;
  return `Shipped ${count}x — last to "${last?.destination}"`;
};

const ShipRow: FC<{ bundle: SkillbookBundle }> = ({ bundle }) => {
  const measuredCount = new Set(bundle.measurements.map((m) => m.fixtureCase)).size;
  const shipping = shippingLine(bundle);
  return (
    <li className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={shipBundleHref(bundle.slug)}
          className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
        >
          {bundle.name}
        </Link>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stageBadgeClass(bundle.stage)}`}>
          {bundle.stage}
        </span>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{bundle.oneLiner}</p>
      <div className="flex flex-wrap gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          {bundle.latestVersion === null ? "No recorded version" : `Version ${shortHash(bundle.latestVersion.hash)}`}
        </span>
        <span>{measuredCount} fixture(s) measured</span>
        {shipping !== undefined && (
          <span className="text-emerald-700 dark:text-emerald-400">{shipping}</span>
        )}
      </div>
    </li>
  );
};

/** The `/ship` index page: one card per bundle. */
export const Ship: FC = () => {
  const { bundles, loading, error } = useSkillbook();

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Ship</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          the shipping bay — skills leave with receipts.
        </p>
      </div>

      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load ship: {error.message}
        </p>
      )}

      {loading && bundles.length === 0 && error === undefined && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
      )}

      <ul className="flex flex-col gap-3">
        {bundles.map((bundle) => (
          <ShipRow key={bundle.slug} bundle={bundle} />
        ))}
        {bundles.length === 0 && !loading && (
          <li className="text-sm text-neutral-400">No Skill Bundles yet.</li>
        )}
      </ul>
    </div>
  );
};

/**
 * A minimal markdown->HTML pass, matching `packages/cli/src/BookRenderer.ts`'s
 * subset exactly (headings/lists/paragraphs/fenced code -- what `design.md`
 * actually uses). Duplicated rather than shared: `BookRenderer.ts` lives in
 * `packages/cli` (a server/CLI-only package the viewer does not depend on),
 * and this is a small, stable, pure function -- not worth a new shared
 * package for one function.
 */
const renderMarkdown = (markdown: string): ReadonlyArray<{ readonly key: string; readonly node: FC }> => {
  const lines = markdown.split("\n");
  const blocks: Array<{ readonly key: string; readonly node: FC }> = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listItems: string[] = [];
  let paragraphLines: string[] = [];
  let index = 0;

  const flushParagraph = (): void => {
    if (paragraphLines.length > 0) {
      const text = paragraphLines.join(" ");
      const key = `p-${index++}`;
      blocks.push({ key, node: () => <p className="text-sm text-neutral-700 dark:text-neutral-300">{text}</p> });
      paragraphLines = [];
    }
  };
  const flushList = (): void => {
    if (listItems.length > 0) {
      const items = listItems;
      const key = `ul-${index++}`;
      blocks.push({
        key,
        node: () => (
          <ul className="list-disc pl-5 text-sm text-neutral-700 dark:text-neutral-300">
            {items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ),
      });
      listItems = [];
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        const code = codeLines.join("\n");
        const key = `pre-${index++}`;
        blocks.push({
          key,
          node: () => (
            <pre className="overflow-x-auto rounded-md bg-neutral-100 p-2 text-xs dark:bg-neutral-900">
              <code>{code}</code>
            </pre>
          ),
        });
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch !== null) {
      flushParagraph();
      flushList();
      const text = headingMatch[2] ?? "";
      const key = `h-${index++}`;
      blocks.push({ key, node: () => <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{text}</h3> });
      continue;
    }
    const listMatch = /^[-*]\s+(.*)$/.exec(line);
    if (listMatch !== null) {
      flushParagraph();
      listItems.push(listMatch[1] ?? "");
      continue;
    }
    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }
    paragraphLines.push(line.trim());
  }
  flushParagraph();
  flushList();

  return blocks;
};

/**
 * The `/ship/:slug` chapter page: design.md + measurement receipts + a
 * changelog -- the bundle's *Skillbook* entry (#72: the paperwork that
 * ships with a skill keeps the Skillbook name; the surface it moves
 * through is Ship, hence the back-link below).
 */
export const SkillbookBundlePage: FC<{ slug: string }> = ({ slug }) => {
  const { bundles, loading, error } = useSkillbook();
  const { navigate } = useRouter();
  const bundle = bundles.find((candidate) => candidate.slug === slug);

  if (loading && bundle === undefined) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>;
  }
  if (error !== undefined) {
    return (
      <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
        Could not load skillbook: {error.message}
      </p>
    );
  }
  if (bundle === undefined) {
    return <p className="text-sm text-neutral-400">No such skill in Ship.</p>;
  }

  const blocks = renderMarkdown(bundle.designMarkdown);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <button
        type="button"
        onClick={() => navigate("/ship")}
        className="w-fit text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
      >
        ← Ship
      </button>

      <div>
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{bundle.name}</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          <span className={`mr-2 rounded-full px-2 py-0.5 font-medium ${stageBadgeClass(bundle.stage)}`}>
            {bundle.stage}
          </span>
          {bundle.oneLiner}
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Design</h2>
        {blocks.length === 0 ? (
          <p className="text-sm text-neutral-400">No design.md content yet.</p>
        ) : (
          blocks.map(({ key, node: Node }) => <Node key={key} />)
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Receipts</h2>
        {bundle.latestVersion === null ? (
          <p className="text-sm text-neutral-400">No version recorded yet.</p>
        ) : (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Latest version: <span className="font-mono">{shortHash(bundle.latestVersion.hash)}</span>
            {bundle.latestVersion.label !== undefined ? ` ("${bundle.latestVersion.label}")` : ""} — recorded{" "}
            {new Date(bundle.latestVersion.recordedAt).toLocaleString()}
          </p>
        )}
        {bundle.measurements.length === 0 ? (
          <p className="text-sm text-neutral-400">No measurements recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="py-1 pr-3">Fixture</th>
                  <th className="py-1 pr-3">Provider/model</th>
                  <th className="py-1 pr-3">Version</th>
                  <th className="py-1 pr-3">n</th>
                  <th className="py-1 pr-3">Pass</th>
                  <th className="py-1 pr-3">Rate</th>
                  <th className="py-1 pr-3">95% CI</th>
                </tr>
              </thead>
              <tbody>
                {bundle.measurements.map((measurement, i) => (
                  <tr key={i} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="py-1 pr-3">{measurement.fixtureCase}</td>
                    <td className="py-1 pr-3">
                      {measurement.provider}/{measurement.model}
                    </td>
                    <td className="py-1 pr-3 font-mono">{shortHash(measurement.versionHash)}</td>
                    <td className="py-1 pr-3">{measurement.n}</td>
                    <td className="py-1 pr-3">
                      {measurement.passes}/{measurement.n}
                    </td>
                    <td className="py-1 pr-3">{(measurement.passRate * 100).toFixed(1)}%</td>
                    <td className="py-1 pr-3">
                      {measurement.ci === null
                        ? "—"
                        : `[${(measurement.ci[0] * 100).toFixed(1)}%, ${(measurement.ci[1] * 100).toFixed(1)}%]`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Shipments</h2>
        {bundle.shipments.length === 0 ? (
          <p className="text-sm text-neutral-400">Never shipped.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bundle.shipments.map((shipment, i) => (
              <li
                key={i}
                className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center gap-2 text-neutral-700 dark:text-neutral-300">
                  <span className="font-medium">{shipment.destination}</span>
                  <span className="text-neutral-400">·</span>
                  <span>{shipment.purpose}</span>
                </div>
                <div className="flex flex-wrap gap-3 text-neutral-500 dark:text-neutral-400">
                  <span className="font-mono">{shortHash(shipment.versionHash)}</span>
                  <span>{new Date(shipment.at).toLocaleString()}</span>
                  <span>
                    {shipment.receipts.length === 0
                      ? "no receipts at ship time"
                      : `${shipment.receipts.length} receipt(s) at ship time`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Changelog</h2>
        {bundle.changelog.length === 0 ? (
          <p className="text-sm text-neutral-400">No journal history yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {bundle.changelog.map((entry, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
                <span className="whitespace-nowrap text-neutral-400">{new Date(entry.at).toLocaleString()}</span>
                <span>{entry.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
