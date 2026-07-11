import type { FC } from "react";
import { Link, useRouter, type Route } from "../runtime/router.tsx";

const NAV_ITEMS: ReadonlyArray<{
  readonly href: string;
  readonly label: string;
  readonly match: (name: Route["name"]) => boolean;
}> = [
  { href: "/", label: "Board", match: (name) => name === "board" || name === "bundle" },
  { href: "/catalog", label: "Catalog", match: (name) => name === "catalog" },
  { href: "/activity", label: "Activity", match: (name) => name === "activity" },
  {
    href: "/skillbook",
    label: "Skillbook",
    match: (name) => name === "skillbook" || name === "skillbook-bundle",
  },
];

const NAV_LINK_ACTIVE =
  "rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900";
const NAV_LINK_INACTIVE =
  "rounded-md px-3 py-1.5 text-sm font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100";

export const Header: FC<{ workspaceName: string | undefined; bundleCount: number }> = ({
  workspaceName,
  bundleCount,
}) => {
  const { route } = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={item.match(route.name) ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="text-right">
        <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {workspaceName ?? "Skillmaker Studio"}
        </h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {bundleCount} {bundleCount === 1 ? "bundle" : "bundles"}
        </p>
      </div>
    </header>
  );
};
