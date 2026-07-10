/**
 * Best-effort "open the URL in a browser" for `skillmaker start` (no
 * `--no-open`). Never throws -- a browser that fails to open must never
 * fail the command; the URL is always also printed to stdout.
 */
export const openBrowser = (url: string): void => {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    Bun.spawn([command, url], { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  } catch {
    // Best-effort only.
  }
};
