/**
 * The `/receive` page (#72, Board · Lab · Ship · Receive · Activity): the
 * receiving bay -- "what the wild sends back." Ship's outbound half of the
 * checkout/return-record primitive (`Vision - Board Lab Ship Receive.md`
 * §HOW) has a manifest (`skill.shipped`, #66); Receive is where its inbound
 * half will land: field reports about shipped skills (issue #67), and later
 * intake/quarantine for arriving skills. That primitive is not built yet,
 * so this page renders an honest empty state naming the job rather than
 * faking data -- no data plumbing in this pass.
 */
import type { FC } from "react";

/** The `/receive` index page: an honest empty state, no data plumbing yet. */
export const Receive: FC = () => (
  <div className="flex max-w-3xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Receive</h1>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        the receiving bay — what the wild sends back.
      </p>
    </div>

    <p className="text-sm text-neutral-400">
      Nothing here yet. Field reports about shipped skills will land here once #67 ships — a skill
      that fails in the wild is a new fixture.
    </p>
  </div>
);
