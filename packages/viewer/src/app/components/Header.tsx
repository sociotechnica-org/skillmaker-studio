import type { FC } from "react";

export const Header: FC<{ workspaceName: string | undefined; bundleCount: number }> = ({
  workspaceName,
  bundleCount,
}) => (
  <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
    <div>
      <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
        {workspaceName ?? "Skillmaker Studio"}
      </h1>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {bundleCount} {bundleCount === 1 ? "bundle" : "bundles"}
      </p>
    </div>
  </header>
);
