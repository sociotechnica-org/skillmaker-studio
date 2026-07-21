import type { FC } from "react";
import { useBundles } from "../runtime/useBundles.ts";
import { ARCHIVED_LABEL, STAGE_LABEL, STAGES, type BundleRecord } from "../runtime/schemas.ts";
import { bundleHref, Link, trackHref, useRouter } from "../runtime/router.tsx";
import { partitionDoorway } from "../runtime/boardDoorway.ts";
import { BoardColumn } from "./BoardColumn.tsx";
import { NewBundleForm } from "./NewBundleForm.tsx";

/** Archived bundles are elided from the stage columns (#109: the Board's Archive pseudo-column retires into Track's Archive drawer -- the link below says where they went). */
const bundlesByColumn = (
  bundles: ReadonlyArray<BundleRecord>,
): ReadonlyMap<string, ReadonlyArray<BundleRecord>> => {
  const columns = new Map<string, BundleRecord[]>();
  for (const stage of STAGES) {
    columns.set(stage, []);
  }
  columns.set("archived", []);

  for (const bundle of bundles) {
    const key = bundle.archived ? "archived" : bundle.stage;
    columns.get(key)?.push(bundle);
  }
  return columns;
};

/**
 * The Archive pseudo-column's replacement (#109): archived isn't a stage
 * (it's the reversible `archived` flag), so the Board stops dressing it up
 * as a sixth column -- retired bundles live in Track's Archive drawer, and
 * this slim pointer says exactly where and how many. Display-layer only;
 * nothing is hidden from the journal or the Catalog.
 */
const ArchivePointer: FC<{ count: number }> = ({ count }) =>
  count === 0 ? null : (
    <div className="flex min-w-40 flex-col gap-2 rounded-xl border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
      <header className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {ARCHIVED_LABEL}
        </h2>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{count}</span>
      </header>
      <Link
        href={trackHref("catalog", { archive: true })}
        className="px-1 text-xs text-neutral-500 hover:underline dark:text-neutral-400"
      >
        {count} in the Archive drawer →
      </Link>
    </div>
  );

/**
 * The Published column's doorway footer (issue #82): "N in the Lab →"
 * whenever ≥1 published bundle has aged out of the doorway window --
 * nothing is hidden from the Lab or the journal, only elided from this
 * one column's cards, and the count says exactly where it went.
 */
const DoorwayFooter: FC<{ elidedCount: number }> = ({ elidedCount }) =>
  elidedCount === 0 ? null : (
    <Link
      href="/lab"
      className="block px-1 text-xs text-neutral-500 hover:underline dark:text-neutral-400"
    >
      {elidedCount} in the eval workspace →
    </Link>
  );

/**
 * The Board -- stage columns + an archived column (route `/`). Bundle
 * selection is a real navigation (`navigate(bundleHref(slug))`), not local
 * state: the bundle page (now the skill card, `SkillCard.tsx`) moved from a side panel to its own route
 * (ui-pass-spec.md §3.3), so there is exactly one way to reach a bundle
 * regardless of which column it's clicked from.
 */
export const Board: FC = () => {
  const { bundles, fixtureCounts, loading, error } = useBundles();
  const { navigate } = useRouter();
  const columns = bundlesByColumn(bundles);
  const onSelect = (slug: string): void => navigate(bundleHref(slug));
  // Evaluated fresh on every render -- the doorway window is real wall-clock
  // time, not a value computed once at fetch time (issue #82).
  const { visible: publishedVisible, elidedCount } = partitionDoorway(
    columns.get("published") ?? [],
    new Date(),
  );

  return (
    <>
      {error !== undefined && (
        <p className="mb-4 rounded-md bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load skills: {error.message}
        </p>
      )}
      {loading && bundles.length === 0 && error === undefined ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
      ) : (
        <div className="flex gap-4">
          {STAGES.map((stage) => (
            <BoardColumn
              key={stage}
              title={STAGE_LABEL[stage]}
              bundles={stage === "published" ? publishedVisible : (columns.get(stage) ?? [])}
              fixtureCounts={fixtureCounts}
              onSelect={onSelect}
              footer={
                stage === "idea" ? (
                  <NewBundleForm />
                ) : stage === "published" ? (
                  <DoorwayFooter elidedCount={elidedCount} />
                ) : undefined
              }
            />
          ))}
          <ArchivePointer count={(columns.get("archived") ?? []).length} />
        </div>
      )}
    </>
  );
};
