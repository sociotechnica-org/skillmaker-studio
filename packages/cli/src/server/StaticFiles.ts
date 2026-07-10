/**
 * Static-file resolution for `skillmaker start`'s viewer server: maps a
 * request pathname onto a real file under the viewer `dist/` directory,
 * guarding against path traversal (`..`, encoded traversal, absolute-path
 * escapes). Never trust a decoded request path directly.
 */
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8",
};

export const contentTypeFor = (path: string): string =>
  CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

/**
 * Resolves `requestPathname` (a URL pathname, e.g. `/assets/app.js` or
 * `/../../etc/passwd`) against `rootDir`. Returns the resolved absolute path
 * if -- and only if -- it stays within `rootDir`; returns `undefined` for
 * any traversal attempt, decode failure, or null-byte injection.
 */
export const resolveStaticPath = (rootDir: string, requestPathname: string): string | undefined => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPathname);
  } catch {
    return undefined;
  }

  if (decoded.includes("\0")) {
    return undefined;
  }

  const normalizedRoot = resolve(rootDir);
  // Force the candidate to resolve as *relative to* the root: leading
  // slashes/drive-letters in `decoded` must not let it become absolute on
  // its own, so join it as `.${decoded}` under the root.
  const relativePortion = decoded.startsWith("/") ? decoded.slice(1) : decoded;
  const candidate = resolve(normalizedRoot, relativePortion);

  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + sep)) {
    return undefined;
  }
  return candidate;
};
