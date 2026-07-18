/**
 * The ONE pill badge of the card era (card-fidelity simplify pass): mono,
 * uppercase, rounded-full -- the shape is fixed here, only the color tone
 * varies (`STAGE_BADGE_CLASS`, `DRIFT_BADGE_CLASS`, `UNVERIFIED_BADGE_CLASS`,
 * `RETIRED_BADGE_CLASS`, ...). Shared by the skill card's header stack and
 * Ship's entry-card summaries so the two surfaces can never drift apart.
 */
import type { FC, ReactNode } from "react";

export const Badge: FC<{ tone: string; title?: string | undefined; children: ReactNode }> = ({
  tone,
  title,
  children,
}) => (
  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase ${tone}`} title={title}>
    {children}
  </span>
);
