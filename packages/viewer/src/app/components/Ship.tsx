/**
 * The `/ship` page (#72; reframed by #109 Stage 3): the shipping bay, and
 * the **Skillbook** it publishes -- the deck's OUTWARD book. "What we stand
 * behind; what you may take." The book's population is curated by facts,
 * not editing: a skill appears once it is published or has shipped at
 * least once -- distinct from Track's Catalog, the complete inside
 * registry (everything that exists, including the unshipped). The two
 * populations never merge; works-in-progress are counted and pointed at
 * the Catalog, never mixed into the book.
 *
 * Same `GET /api/skillbook` data as always (`skillmaker book build`'s one
 * generator over existing facts, untouched -- #109 Stage 3 is framing/
 * layout only): per-bundle chapters (`/ship/:slug`) render design.md,
 * measurement receipts, shipments, and the journal changelog. A chapter
 * stays reachable for ANY slug via deep link -- curation shapes the index,
 * it never 404s the paperwork.
 */
import type { FC } from "react";
import { provenOnProviders } from "../runtime/cardGlance.ts";
import { bundleHref, Link, shipBundleHref, trackHref, useRouter } from "../runtime/router.tsx";
import { STAGE_BADGE_CLASS, STAGE_LABEL, type BundleStage, type SkillbookBundle } from "../runtime/schemas.ts";
import { useSkillbook } from "../runtime/useSkillbook.ts";
import { Badge } from "./Badge.tsx";

/** The Skillbook payload's `stage` is a plain string on the wire, so unknown values fall back to the idea-gray badge instead of an undefined class. */
const stageBadgeClass = (stage: string): string =>
  STAGE_BADGE_CLASS[stage as BundleStage] ?? "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";

/** The stage's display word (the card era's vocabulary, e.g. "Proof" for `evaluating`) -- the raw wire word only when unknown, mirroring `stageBadgeClass`'s fallback. */
const stageLabel = (stage: string): string => STAGE_LABEL[stage as BundleStage] ?? stage;

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

/**
 * One book entry as a CARD SUMMARY (card-fidelity round, problem 1): a
 * mini skill card echoing the full card's glance language -- mono slug +
 * one-liner, a stage · short-hash badge, the proven-on / measured tally,
 * and the shipped line. The slug links to the full skill card; the
 * "Skillbook entry" link keeps the per-bundle receipts/history chapter
 * (`/ship/:slug`) reachable, exactly as before.
 */
const ShipEntryCard: FC<{ bundle: SkillbookBundle }> = ({ bundle }) => {
  const measuredCount = new Set(bundle.measurements.map((m) => m.fixtureCase)).size;
  const proven = provenOnProviders(bundle.measurements, bundle.latestVersion?.hash);
  const shipping = shippingLine(bundle);
  return (
    <li className="card-shadow-sm flex flex-col gap-1.5 overflow-hidden rounded-lg border border-ink/70 bg-surface">
      <div className="h-1 bg-amber-500" aria-hidden="true" />
      <div className="flex flex-col gap-1.5 px-4 pb-3 pt-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Link
            href={bundleHref(bundle.slug)}
            className="break-words font-mono text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-100"
          >
            {bundle.slug}
          </Link>
          <Badge
            tone={stageBadgeClass(bundle.stage)}
            title={bundle.latestVersion === null ? "No version recorded yet." : bundle.latestVersion.hash}
          >
            {stageLabel(bundle.stage)}
            {" · "}
            {bundle.latestVersion === null ? "no version" : shortHash(bundle.latestVersion.hash)}
          </Badge>
        </div>
        {bundle.oneLiner.length > 0 && (
          <p className="text-xs text-neutral-600 dark:text-neutral-300">{bundle.oneLiner}</p>
        )}
        <p className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
          {proven.length === 0 ? "proven on: none yet" : `proven on ${proven.join(", ")}`}
          {" · "}
          {measuredCount} fixture(s) measured
        </p>
        {shipping !== undefined && (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{shipping}</p>
        )}
        <Link
          href={shipBundleHref(bundle.slug)}
          className="text-[11px] text-sky-700 hover:underline dark:text-sky-300"
        >
          Skillbook entry — receipts &amp; changelog →
        </Link>
      </div>
    </li>
  );
};

/**
 * The `/ship` index page (card-fidelity round, problem 1 -- one page, one
 * clear structure): a small doorplate header, then THE SKILLBOOK as a real
 * book-cover object (spine accent + centered cover type -- clearly a book,
 * not a skill card: no stage badges, no card affordances), then the book's
 * entries as card summaries, then the Catalog pointer. The population is
 * the server-derived `inBook` (`Skillbook.ts`'s `isInSkillbook`) -- one
 * definition, shared with `book build`'s static index.
 */
export const Ship: FC = () => {
  const { bundles, workspaceName, loading, error } = useSkillbook();
  const inBook = bundles.filter((bundle) => bundle.inBook);
  const insideCount = bundles.length - inBook.length;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      {/* The doorplate: visually minor -- the cover below is the headline. */}
      <div>
        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">Ship</h1>
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

      {/* The book COVER (#109 Stage 3; card-fidelity round): a distinct
          object -- ink border, offset shadow like the card family, but a
          left spine band and centered cover type so it reads as a book. */}
      <section className="card-shadow-lg flex overflow-hidden rounded-lg border-2 border-ink bg-surface">
        <div className="w-3 shrink-0 bg-amber-500" aria-hidden="true" />
        <div className="flex flex-1 flex-col items-center gap-2 px-6 py-8 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-600 dark:text-amber-400">
            the outward book
          </p>
          <h2 className="font-display text-2xl text-neutral-900 sm:text-3xl dark:text-neutral-100">
            The Skillbook
          </h2>
          {workspaceName !== undefined && (
            <p className="font-mono text-xs uppercase tracking-[0.15em] text-neutral-500 dark:text-neutral-400">
              {workspaceName}
            </p>
          )}
          <p className="max-w-md text-sm text-neutral-600 dark:text-neutral-300">
            What we stand behind; what you may take. Every entry carries its receipts — measurements at a
            pinned version, shipments, and the journal trail.
          </p>
          <p className="font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
            {inBook.length === 0
              ? "Nothing published or shipped yet — the book is honestly empty."
              : `${inBook.length} skill${inBook.length === 1 ? "" : "s"} in the book`}
          </p>
        </div>
      </section>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {inBook.map((bundle) => (
          <ShipEntryCard key={bundle.slug} bundle={bundle} />
        ))}
      </ul>

      {insideCount > 0 && (
        <p className="text-[11px] text-neutral-400">
          <Link href={trackHref()} className="text-sky-700 hover:underline dark:text-sky-300">
            {insideCount} more in progress live in the Catalog →
          </Link>
        </p>
      )}
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
            {stageLabel(bundle.stage)}
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
