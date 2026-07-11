/**
 * The `/activity` page: a paginated, newest-first feed of the whole journal
 * (`GET /api/events`), not scoped to a single bundle -- the ui-pass-spec's
 * third nav-adjacent route (spec §3.1). Each row shows the event type, actor,
 * timestamp, and a payload's `bundle` field when present (most event types
 * carry one); the raw payload is left collapsed behind a `<details>` for
 * anyone who needs the full shape.
 */
import type { FC } from "react";
import { bundleHref, Link } from "../runtime/router.tsx";
import type { EventView } from "../runtime/schemas.ts";
import { useEvents } from "../runtime/useEvents.ts";

const payloadBundle = (payload: unknown): string | undefined => {
  if (typeof payload !== "object" || payload === null || !("bundle" in payload)) {
    return undefined;
  }
  const value = (payload as { bundle: unknown }).bundle;
  return typeof value === "string" ? value : undefined;
};

const formatTimestamp = (at: string): string => {
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? at : parsed.toLocaleString();
};

const EventRow: FC<{ event: EventView }> = ({ event }) => {
  const bundle = payloadBundle(event.payload);
  return (
    <li className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          {event.type}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatTimestamp(event.at)}</span>
        <span className="text-xs text-neutral-400">
          {event.actor.kind}:{event.actor.name}
          {event.actor.provider !== undefined ? ` (${event.actor.provider})` : ""}
        </span>
        {bundle !== undefined && (
          <Link href={bundleHref(bundle)} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            {bundle}
          </Link>
        )}
      </div>
      <details className="text-xs text-neutral-500 dark:text-neutral-400">
        <summary className="cursor-pointer select-none">payload</summary>
        <pre className="mt-1 overflow-x-auto rounded bg-neutral-50 p-2 dark:bg-neutral-900">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      </details>
    </li>
  );
};

export const ActivityFeed: FC = () => {
  const { events, loading, loadingMore, error, hasMore, loadMore } = useEvents();

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Activity</h1>

      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load events: {error.message}
        </p>
      )}

      {loading && events.length === 0 && error === undefined && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>
      )}

      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
        {events.length === 0 && !loading && (
          <li className="text-sm text-neutral-400">No events yet.</li>
        )}
      </ul>

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="w-fit rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
        >
          {loadingMore ? "Loading..." : "Load more"}
        </button>
      )}
    </div>
  );
};
