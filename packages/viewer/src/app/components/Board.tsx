import type { FC } from "react";
import { useBundles } from "../runtime/useBundles.ts";
import type { BundleRecord, BundleStage } from "../runtime/schemas.ts";
import { bundleHref, useRouter } from "../runtime/router.tsx";
import { BoardColumn } from "./BoardColumn.tsx";

const STAGE_COLUMNS: ReadonlyArray<{ stage: BundleStage; title: string }> = [
  { stage: "idea", title: "Idea" },
  { stage: "researching", title: "Researching" },
  { stage: "drafting", title: "Drafting" },
  { stage: "evaluating", title: "Evaluating" },
  { stage: "published", title: "Published" },
];

/** Archived bundles render in the archived column regardless of stage. */
const bundlesByColumn = (
  bundles: ReadonlyArray<BundleRecord>,
): ReadonlyMap<string, ReadonlyArray<BundleRecord>> => {
  const columns = new Map<string, BundleRecord[]>();
  for (const { stage } of STAGE_COLUMNS) {
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
 * The Board -- stage columns + an archived column (route `/`). Bundle
 * selection is a real navigation (`navigate(bundleHref(slug))`), not local
 * state: `BundlePanel` moved from a side panel to its own route
 * (ui-pass-spec.md §3.3), so there is exactly one way to reach a bundle
 * regardless of which column it's clicked from.
 */
export const Board: FC = () => {
  const { bundles, fixtureCounts, loading, error } = useBundles();
  const { navigate } = useRouter();
  const columns = bundlesByColumn(bundles);
  const onSelect = (slug: string): void => navigate(bundleHref(slug));

  return (
    <>
      {error !== undefined && (
        <p className="mb-4 rounded-md bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load bundles: {error.message}
        </p>
      )}
      {loading && bundles.length === 0 && error === undefined ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
      ) : (
        <div className="flex gap-4">
          {STAGE_COLUMNS.map(({ stage, title }) => (
            <BoardColumn
              key={stage}
              title={title}
              bundles={columns.get(stage) ?? []}
              fixtureCounts={fixtureCounts}
              onSelect={onSelect}
            />
          ))}
          <BoardColumn
            title="Archived"
            bundles={columns.get("archived") ?? []}
            fixtureCounts={fixtureCounts}
            onSelect={onSelect}
          />
        </div>
      )}
    </>
  );
};
