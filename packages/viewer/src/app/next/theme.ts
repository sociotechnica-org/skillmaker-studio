/**
 * Theme preference logic for the manuscript-at-night dark mode.
 *
 * Rules (mirrored by the pre-paint script in pages/index.astro — keep the
 * two in sync): an explicit stored choice ("dark" / "light" under the
 * "sm-theme" key) always wins; with nothing stored (or garbage), the OS
 * preference decides. The `.dark` class on <html> is the single source of
 * visual truth — Tailwind's dark: variant is retargeted to it in global.css.
 */

export const THEME_STORAGE_KEY = "sm-theme";

export type Theme = "dark" | "light";

/** Pure: stored value (may be null/garbage) + OS preference → effective theme. */
export function effectiveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === "dark") return "dark";
  if (stored === "light") return "light";
  return prefersDark ? "dark" : "light";
}

/** Read the current theme from the DOM (the pre-paint script already ran). */
export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Apply + persist an explicit choice; explicit choices win from then on. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / storage disabled — theme just won't persist */
  }
}
