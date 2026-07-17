import { useEffect, useState, type FC } from "react";
import { Link, useRouter, type Route } from "../runtime/router.tsx";

const NAV_ITEMS: ReadonlyArray<{
  readonly href: string;
  readonly label: string;
  readonly match: (name: Route["name"]) => boolean;
}> = [
  { href: "/", label: "Make", match: (name) => name === "board" || name === "bundle" },
  { href: "/lab", label: "Improve", match: (name) => name === "lab" },
  {
    href: "/ship",
    label: "Ship",
    match: (name) => name === "ship" || name === "ship-bundle",
  },
  { href: "/receive", label: "Receive", match: (name) => name === "receive" },
  { href: "/activity", label: "Activity", match: (name) => name === "activity" },
];

const NAV_LINK_ACTIVE =
  "font-display uppercase tracking-wide rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900";
const NAV_LINK_INACTIVE =
  "font-display uppercase tracking-wide rounded-md px-3 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100";

const useTheme = (): { dark: boolean; toggle: () => void } => {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = (): void => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("sm-theme", next ? "dark" : "light");
    } catch {
      /* private mode / storage disabled — theme just won't persist */
    }
    setDark(next);
  };
  return { dark, toggle };
};

export const Header: FC<{ workspaceName: string | undefined; bundleCount: number }> = ({
  workspaceName,
  bundleCount,
}) => {
  const { route } = useRouter();
  const { dark, toggle } = useTheme();

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 dark:border-neutral-800">
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={item.match(route.name) ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="font-display rounded-md border border-neutral-300 px-2 py-1 text-xs uppercase tracking-wide text-neutral-600 hover:border-neutral-400 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          {dark ? "☀ Light" : "☾ Dark"}
        </button>
        <Link href="/" className="flex flex-col items-end">
          <span className="skillmaker-logo" aria-hidden="true" />
          <span className="sr-only">{workspaceName ?? "Skillmaker Studio"} home</span>
          <span className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {bundleCount} {bundleCount === 1 ? "bundle" : "bundles"}
          </span>
        </Link>
      </div>
    </header>
  );
};
