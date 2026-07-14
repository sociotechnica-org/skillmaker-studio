/**
 * The board's "+ New bundle" affordance, rendered in the Idea column (and
 * reusable elsewhere): a human types a skill idea's name, we derive the
 * kebab-case slug, and `POST /api/bundles` scaffolds it in the idea stage --
 * the same `skillmaker new` path, now reachable without a terminal. On success
 * we navigate straight into the new bundle so the idea → design loop can start.
 */
import { type FC, useState } from "react";
import { createBundle } from "../runtime/api.ts";
import { bundleHref, useRouter } from "../runtime/router.tsx";

/** Mirrors core's slug rule (`^[a-z0-9]+(-[a-z0-9]+)*$`): lowercase, non-alphanumerics collapse to single hyphens, trimmed. */
export const toSlug = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const NewBundleForm: FC = () => {
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const slug = toSlug(name);

  const reset = (): void => {
    setName("");
    setError(undefined);
    setPending(false);
    setOpen(false);
  };

  const submit = (): void => {
    if (slug.length === 0) {
      return;
    }
    setPending(true);
    setError(undefined);
    createBundle(slug, name.trim().length > 0 ? name.trim() : undefined)
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          setPending(false);
          return;
        }
        if (result.response.status === "already_exists") {
          setError(`A bundle named "${slug}" already exists.`);
          setPending(false);
          return;
        }
        navigate(bundleHref(result.response.slug));
      })
      .catch((cause: Error) => {
        setError(cause.message);
        setPending(false);
      });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-dashed border-neutral-300 px-2 py-2 text-xs font-medium text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200"
      >
        + New bundle
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-300 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900">
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") reset();
        }}
        placeholder="New skill idea…"
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />
      {name.trim().length > 0 && (
        <p className="px-1 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
          {slug.length > 0 ? `slug: ${slug}` : "needs at least one letter or number"}
        </p>
      )}
      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-[11px] text-red-800 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || slug.length === 0}
          onClick={submit}
          className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={reset}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
