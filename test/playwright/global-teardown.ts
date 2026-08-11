import { rmSync } from "node:fs";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export default async function globalTeardown(): Promise<void> {
  const raw = process.env.SKILLMAKER_PLAYWRIGHT_STATE;
  if (raw === undefined) return;
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) return;

  const pids = Array.isArray(parsed.pids)
    ? parsed.pids.filter((pid): pid is number => typeof pid === "number")
    : [];
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already stopped.
    }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && pids.some((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  })) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (typeof parsed.scratchRoot === "string") {
    rmSync(parsed.scratchRoot, { recursive: true, force: true });
  }
}
