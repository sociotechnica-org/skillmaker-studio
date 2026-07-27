/**
 * The server-side directory browser + folder creation behind the viewer's
 * "New project" dialog (director ruling 2026-07-27 #3): a browser cannot
 * yield absolute paths from a native file dialog, so the SERVER reads the
 * disk. The dialog's trigger stays abstract enough that a desktop-native
 * dialog can replace this picker later without an API change.
 *
 * Path safety rules (charter):
 * - Absolute paths only; anything else is a 400.
 * - Symlinks are resolved (`realpathSync`) before listing, so a listing is
 *   always of a real directory and the returned `path` is canonical.
 * - `resolve()` normalizes `..` segments away before any filesystem touch --
 *   there is no relative traversal to exploit.
 * - DIRECTORIES ONLY: file names are never listed, file contents never read.
 * - Dot-directories are skipped in listings (hidden state, `.git`, etc.);
 *   a dot-path typed explicitly into the path field still validates.
 */
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_CONFIG_FILENAME } from "@skillmaker/core";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const isProjectDir = (dir: string): boolean => existsSync(join(dir, DEFAULT_CONFIG_FILENAME));

/**
 * `GET /api/fs/list?path=<abs>` -- one directory level: subdirectories only,
 * each flagged `isProject` when it carries a `skillmaker.config.json`.
 * Omitted `path` starts at the user's home directory (the natural root for
 * "pick a project folder"). Unreadable children are skipped, never fatal.
 */
export const handleFsList = (url: URL): Response => {
  const raw = url.searchParams.get("path") ?? homedir();
  if (!isAbsolute(raw)) {
    return jsonResponse({ error: "path must be absolute" }, 400);
  }
  let real: string;
  try {
    real = realpathSync(resolve(raw));
  } catch {
    return jsonResponse({ error: `no such directory "${raw}"` }, 404);
  }
  let entries: Array<Dirent>;
  try {
    if (!statSync(real).isDirectory()) {
      return jsonResponse({ error: `"${raw}" is not a directory` }, 400);
    }
    entries = readdirSync(real, { withFileTypes: true });
  } catch (cause) {
    return jsonResponse({ error: `could not read directory: ${String(cause)}` }, 400);
  }

  const dirs: Array<{ name: string; path: string; isProject: boolean }> = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const childPath = join(real, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDir = statSync(childPath).isDirectory();
      } catch {
        continue; // dangling symlink -- skip, never fatal
      }
    }
    if (!isDir) continue; // directories ONLY -- files are never listed
    dirs.push({ name: entry.name, path: childPath, isProject: isProjectDir(childPath) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  const parent = dirname(real);
  return jsonResponse({
    path: real,
    parent: parent === real ? null : parent,
    home: homedir(),
    isProject: isProjectDir(real),
    dirs,
  });
};

/**
 * `GET /api/fs/validate?path=<abs>` -- the typed-path field's live
 * validation: what is at this path, is it a workspace already, is it
 * registered already. Pure lookup, never writes.
 */
export const handleFsValidate = (url: URL, isRegistered: (path: string) => boolean): Response => {
  const raw = url.searchParams.get("path");
  if (raw === null || raw.length === 0) {
    return jsonResponse({ error: "path is required" }, 400);
  }
  if (!isAbsolute(raw)) {
    return jsonResponse({ path: raw, valid: false, reason: "path must be absolute" });
  }
  const normalized = resolve(raw);
  if (!existsSync(normalized)) {
    const parent = dirname(normalized);
    const parentIsDir = existsSync(parent) && statSync(parent).isDirectory();
    return jsonResponse({
      path: normalized,
      valid: false,
      reason: "does not exist",
      // The dialog's "create new folder here" affordance gates on this.
      creatable: parentIsDir,
    });
  }
  let real: string;
  try {
    real = realpathSync(normalized);
  } catch (cause) {
    return jsonResponse({ path: normalized, valid: false, reason: String(cause) });
  }
  if (!statSync(real).isDirectory()) {
    return jsonResponse({ path: real, valid: false, reason: "not a directory" });
  }
  return jsonResponse({
    path: real,
    valid: true,
    isProject: isProjectDir(real),
    registered: isRegistered(real),
  });
};

/**
 * `POST /api/fs/mkdir {path}` -- the dialog's "create new folder here"
 * action. The PARENT must already exist (no recursive scaffolding of typo'd
 * ancestor chains); creating an existing directory is a 409.
 */
export const handleFsMkdir = async (request: Request): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  const raw = typeof body === "object" && body !== null ? (body as { path?: unknown }).path : undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    return jsonResponse({ error: "path is required" }, 400);
  }
  if (!isAbsolute(raw)) {
    return jsonResponse({ error: "path must be absolute" }, 400);
  }
  const normalized = resolve(raw);
  if (basename(normalized).startsWith(".")) {
    return jsonResponse({ error: "refusing to create a hidden directory" }, 400);
  }
  if (existsSync(normalized)) {
    return jsonResponse({ error: `"${normalized}" already exists` }, 409);
  }
  const parent = dirname(normalized);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    return jsonResponse({ error: `parent directory "${parent}" does not exist` }, 400);
  }
  try {
    mkdirSync(normalized);
  } catch (cause) {
    return jsonResponse({ error: `could not create directory: ${String(cause)}` }, 500);
  }
  return jsonResponse({ status: "created", path: normalized }, 201);
};
