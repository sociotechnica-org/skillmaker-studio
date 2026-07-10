import type { FC } from "react";
import type { BundleRecord } from "../runtime/schemas.ts";

export const BundleCard: FC<{ bundle: BundleRecord }> = ({ bundle }) => (
  <article className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
    <div className="flex items-start justify-between gap-2">
      <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {bundle.name}
      </h3>
      {bundle.substate === "awaiting-review" && (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          awaiting review
        </span>
      )}
    </div>
    <p className="mt-1 font-mono text-xs text-neutral-500 dark:text-neutral-400">{bundle.slug}</p>
    {bundle.oneLiner.length > 0 && (
      <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">{bundle.oneLiner}</p>
    )}
  </article>
);
