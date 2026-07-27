/**
 * The New-project dialog (machine-registry rulings 2026-07-27 #3): pick an
 * EXISTING directory or CREATE a new one, entirely through the server's
 * disk (`/api/fs/*`) -- a browser cannot yield absolute paths from native
 * file dialogs. Three coordinated affordances:
 *
 *   1. a typed-path field with live validation (`/api/fs/validate`);
 *   2. a server-side directory browser (`/api/fs/list`, dirs only);
 *   3. "new folder here" (`/api/fs/mkdir`).
 *
 * Confirm registers via `POST /api/projects`; a directory that is not a
 * skillmaker workspace yet triggers the explicit needs_init confirm step
 * ("set it up?"), which re-posts with `init: true` -- the server scaffolds
 * the default workspace with the same core path `skillmaker init` uses.
 *
 * The TRIGGER for this dialog is a plain button (Sidebar): a desktop-native
 * dialog can replace this picker later by yielding an absolute path into
 * the same `registerProject` call.
 */
import { useEffect, useRef, useState } from "react";
import {
  createDirectory,
  fetchDirListing,
  registerProject,
  validatePath,
  type FsListing,
  type PathValidation,
} from "./projectsApi.ts";
import { Button } from "./ui.tsx";

const VALIDATE_DEBOUNCE_MS = 250;

export function NewProjectDialog({
  onClose,
  onRegistered,
}: {
  readonly onClose: () => void;
  /** Called with the new project's slug (when the server reported one) after successful registration. */
  readonly onRegistered: (slug: string | null) => void;
}) {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<FsListing | null>(null);
  const [validation, setValidation] = useState<PathValidation | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [needsInit, setNeedsInit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Opening listing: the server's home directory.
  useEffect(() => {
    void fetchDirListing().then((initial) => {
      if (initial !== null) {
        setListing(initial);
        setPath(initial.path);
      }
    });
  }, []);

  // Typed-path live validation, debounced.
  useEffect(() => {
    if (validateTimer.current !== undefined) clearTimeout(validateTimer.current);
    if (path.length === 0) {
      setValidation(null);
      return;
    }
    validateTimer.current = setTimeout(() => {
      void validatePath(path).then(setValidation);
    }, VALIDATE_DEBOUNCE_MS);
    return () => {
      if (validateTimer.current !== undefined) clearTimeout(validateTimer.current);
    };
  }, [path]);

  const browseTo = (target: string) => {
    setNeedsInit(false);
    setError(null);
    void fetchDirListing(target).then((next) => {
      if (next !== null) {
        setListing(next);
        setPath(next.path);
      }
    });
  };

  const submit = async (withInit: boolean) => {
    setBusy(true);
    setError(null);
    const create = validation !== null && !validation.valid && validation.creatable === true;
    const result = await registerProject(path, {
      ...(create ? { create: true, init: true } : {}),
      ...(withInit ? { init: true } : {}),
    });
    setBusy(false);
    if (result.kind === "registered") {
      onRegistered(result.slug);
      onClose();
      return;
    }
    if (result.kind === "needs_init") {
      setNeedsInit(true);
      return;
    }
    setError(result.message);
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (name.length === 0 || listing === null) return;
    setBusy(true);
    setError(null);
    const target = `${listing.path.endsWith("/") ? listing.path.slice(0, -1) : listing.path}/${name}`;
    const failure = await createDirectory(target);
    setBusy(false);
    if (failure !== null) {
      setError(failure);
      return;
    }
    setCreatingFolder(false);
    setNewFolderName("");
    browseTo(target);
  };

  const validationLine = (): { text: string; tone: "ok" | "warn" | "bad" } | null => {
    if (validation === null) return null;
    if (validation.valid) {
      if (validation.registered === true) return { text: "Already registered.", tone: "warn" };
      if (validation.isProject === true) return { text: "Existing skillmaker project -- will be registered.", tone: "ok" };
      return { text: "Directory exists but is not a skillmaker project yet -- it will be set up.", tone: "warn" };
    }
    if (validation.creatable === true) return { text: "Does not exist -- will be created and set up.", tone: "warn" };
    return { text: validation.reason ?? "Invalid path.", tone: "bad" };
  };
  const line = validationLine();
  const canSubmit =
    !busy &&
    path.length > 0 &&
    validation !== null &&
    validation.registered !== true &&
    (validation.valid || validation.creatable === true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[520px] max-w-[92vw] rounded-lg border border-border bg-paper p-4 shadow-xl">
        <div className="pb-2 font-display text-lg">New project</div>
        <p className="pb-3 text-xs text-ink-muted">
          A project is a directory on this machine. Pick an existing one or create a new folder; a directory without a
          skillmaker setup gets the default scaffold.
        </p>

        <label className="block pb-1 text-xs uppercase tracking-widest text-ink-muted" htmlFor="np-path">
          Directory path
        </label>
        <input
          id="np-path"
          type="text"
          value={path}
          onChange={(e) => {
            setNeedsInit(false);
            setPath(e.target.value);
          }}
          spellCheck={false}
          className="w-full rounded border border-border bg-surface px-2 py-1.5 font-mono text-sm"
          placeholder="/absolute/path/to/project"
        />
        {line !== null && (
          <div
            className={`pt-1 text-xs ${line.tone === "ok" ? "text-green-700 dark:text-green-400" : line.tone === "warn" ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"}`}
          >
            {line.text}
          </div>
        )}

        {/* server-side directory browser -- directories only, by design */}
        <div className="mt-3 rounded border border-border">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-xs">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40"
              disabled={listing?.parent == null}
              onClick={() => listing?.parent != null && browseTo(listing.parent)}
            >
              ↑ Up
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-ink-muted" title={listing?.path ?? ""}>
              {listing?.path ?? "…"}
            </span>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-ink-muted hover:bg-surface hover:text-ink"
              onClick={() => setCreatingFolder(true)}
            >
              + New folder
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {creatingFolder && (
              <div className="flex items-center gap-1 px-2 py-1">
                <input
                  type="text"
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createFolder();
                    if (e.key === "Escape") setCreatingFolder(false);
                  }}
                  className="flex-1 rounded border border-border bg-surface px-2 py-0.5 font-mono text-sm"
                  placeholder="folder-name"
                />
                <Button label="Create" onClick={() => void createFolder()} disabled={busy || newFolderName.trim().length === 0} />
              </div>
            )}
            {(listing?.dirs ?? []).map((dir) => (
              <button
                key={dir.path}
                type="button"
                onClick={() => browseTo(dir.path)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-surface"
              >
                <span className="text-ink-muted">▸</span>
                <span className="min-w-0 flex-1 truncate font-mono">{dir.name}</span>
                {dir.isProject && <span className="rounded bg-amber-200 px-1.5 text-[10px] text-amber-900">project</span>}
              </button>
            ))}
            {listing !== null && listing.dirs.length === 0 && !creatingFolder && (
              <div className="px-2 py-2 text-xs text-ink-muted">No subdirectories.</div>
            )}
          </div>
        </div>

        {error !== null && <div className="pt-2 text-xs text-red-700 dark:text-red-400">{error}</div>}

        {needsInit ? (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-700 dark:bg-amber-950">
            <p className="pb-2">
              This directory is not a skillmaker workspace yet. Set it up with the default scaffold
              (skillmaker.config.json, skills/, .skillmaker/) and register it?
            </p>
            <div className="flex justify-end gap-2">
              <Button label="Back" onClick={() => setNeedsInit(false)} disabled={busy} />
              <Button label="Set up and register" primary onClick={() => void submit(true)} disabled={busy} />
            </div>
          </div>
        ) : (
          <div className="mt-3 flex justify-end gap-2">
            <Button label="Cancel" onClick={onClose} disabled={busy} />
            <Button label={busy ? "Working…" : "Use this directory"} primary onClick={() => void submit(false)} disabled={!canSubmit} />
          </div>
        )}
      </div>
    </div>
  );
}
