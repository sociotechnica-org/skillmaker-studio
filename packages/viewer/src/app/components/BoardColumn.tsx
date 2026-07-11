import type { FC } from "react";
import type { BundleRecord } from "../runtime/schemas.ts";
import { BundleCard } from "./BundleCard.tsx";

export const BoardColumn: FC<{
  title: string;
  bundles: ReadonlyArray<BundleRecord>;
  onSelect?: (slug: string) => void;
}> = ({ title, bundles, onSelect }) => (
  <div className="flex min-w-56 flex-1 flex-col gap-2 rounded-xl bg-neutral-100/60 p-3 dark:bg-neutral-900/40">
    <header className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h2>
      <span className="text-xs text-neutral-400 dark:text-neutral-500">{bundles.length}</span>
    </header>
    <div className="flex flex-col gap-2">
      {bundles.map((bundle) => (
        <BundleCard key={bundle.slug} bundle={bundle} onSelect={onSelect} />
      ))}
    </div>
  </div>
);
