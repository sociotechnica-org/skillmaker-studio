/** Shared presentational primitives for the next shell. */
import type { ClaimStatus, Stage } from "./types.ts";

/**
 * One-line label that fades out on the right instead of ellipsizing.
 * The fade zone is a fixed 20px at the container's right edge, so it only
 * touches text that actually overflows — short labels render untouched.
 * MUST sit on a width-constrained element (flex-1 min-w-0 or w-full),
 * never a content-sized span, or the fade eats every label's tail.
 * Theme-proof: masks composite on the alpha channel, so the literal `black`
 * here is just "fully opaque" — it renders identically in dark mode.
 */
export const FADE_R =
  "overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%_-_20px),transparent_calc(100%_-_2px))]";

/** Stage tints. All but Idea flip for dark mode at the token level in
 * global.css (X-100/-800 are re-tinted under .dark); the neutral ramp is
 * deliberately not flipped there, so Idea carries its own dark: pair. */
export const STAGE_TINT: Record<Stage, string> = {
  Idea: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  Research: "bg-sky-100 text-sky-800",
  Drafting: "bg-indigo-100 text-indigo-800",
  Evals: "bg-amber-100 text-amber-800",
  Published: "bg-emerald-100 text-emerald-800",
};

export const CLAIM_DOT: Record<ClaimStatus, string> = {
  proven: "●",
  partial: "◐",
  unmeasured: "◌",
  gap: "○",
};

export function StageBadge({ stage }: { readonly stage: Stage }) {
  return <span className={`shrink-0 rounded px-1.5 text-[10px] ${STAGE_TINT[stage]}`}>{stage}</span>;
}

export function Button({
  label,
  primary,
  onClick,
  title,
  disabled,
}: {
  readonly label: string;
  readonly primary?: boolean;
  readonly onClick?: () => void;
  readonly title?: string;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "rounded bg-amber-600 px-3 py-1.5 font-display text-sm text-white shadow hover:bg-amber-700 disabled:cursor-default disabled:bg-amber-600/50 disabled:hover:bg-amber-600/50"
          : "rounded border border-border bg-surface px-3 py-1.5 font-display text-sm text-ink-muted hover:text-ink disabled:cursor-default disabled:opacity-60 disabled:hover:text-ink-muted"
      }
    >
      {label}
    </button>
  );
}

/** Small icon button with the shell's idle/hover/active chrome. */
export function IconButton({
  active,
  onClick,
  title,
  children,
  className = "",
  ...dataAttrs
}: {
  readonly active?: boolean;
  readonly onClick?: () => void;
  readonly title?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
} & Record<`data-${string}`, boolean | string>) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded p-1.5 ${
        active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:bg-surface hover:text-ink"
      } ${className}`}
      {...dataAttrs}
    >
      {children}
    </button>
  );
}
