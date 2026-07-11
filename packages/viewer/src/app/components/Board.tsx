import { type FC, useState } from "react";
import { useBundles } from "../runtime/useBundles.ts";
import type { BundleRecord, BundleStage } from "../runtime/schemas.ts";
import { BoardColumn } from "./BoardColumn.tsx";
import { BundlePanel } from "./BundlePanel.tsx";
import { Header } from "./Header.tsx";
import { TodosPanel } from "./TodosPanel.tsx";
import { useWorkspace } from "../runtime/useWorkspace.ts";

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

export const Board: FC = () => {
  const { bundles, loading, error } = useBundles();
  const { state } = useWorkspace();
  const columns = bundlesByColumn(bundles);
  const [selectedSlug, setSelectedSlug] = useState<string | undefined>(undefined);

  return (
    <div className="flex min-h-screen flex-col">
      <Header workspaceName={state?.workspace.name} bundleCount={bundles.length} />
      <div className="flex flex-1">
        <main className="flex-1 overflow-x-auto p-6">
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
                  onSelect={setSelectedSlug}
                />
              ))}
              <BoardColumn
                title="Archived"
                bundles={columns.get("archived") ?? []}
                onSelect={setSelectedSlug}
              />
            </div>
          )}
        </main>
        {selectedSlug !== undefined && (
          <BundlePanel slug={selectedSlug} onClose={() => setSelectedSlug(undefined)} />
        )}
        <TodosPanel bundles={bundles} />
      </div>
    </div>
  );
};
