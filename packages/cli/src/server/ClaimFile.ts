/**
 * Single-instance ownership for `skillmaker start`:
 * `.skillmaker/claims/server.json` — `{pid, port, startedAt}`. If a claim
 * exists and its PID is alive, a second `start` defers to it; if the PID is
 * dead (process crashed without cleanup), the claim is stale and gets
 * replaced.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ClaimFileData {
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
}

export type ClaimStatus =
  | { readonly kind: "absent" }
  | { readonly kind: "running"; readonly claim: ClaimFileData }
  | { readonly kind: "stale"; readonly claim: ClaimFileData };

/**
 * Checks whether a process with the given PID is alive, using the
 * zero-signal `kill` probe. `EPERM` still means the process exists (just
 * owned by someone else); any other error (typically `ESRCH`) means it's
 * gone.
 */
export const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const isClaimFileData = (value: unknown): value is ClaimFileData =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>)["pid"] === "number" &&
  typeof (value as Record<string, unknown>)["port"] === "number" &&
  typeof (value as Record<string, unknown>)["startedAt"] === "string";

export const readClaim = (claimPath: string): ClaimFileData | undefined => {
  if (!existsSync(claimPath)) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(claimPath, "utf8"));
    return isClaimFileData(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Pure classification, decoupled from the filesystem/process for unit
 * testing: given an (optional) claim and a liveness predicate, decides
 * whether the slot is free, held by a live process, or held by a stale one.
 */
export const classifyClaim = (
  claim: ClaimFileData | undefined,
  checkAlive: (pid: number) => boolean = isPidAlive,
): ClaimStatus => {
  if (claim === undefined) {
    return { kind: "absent" };
  }
  return checkAlive(claim.pid) ? { kind: "running", claim } : { kind: "stale", claim };
};

export const writeClaim = (claimPath: string, data: ClaimFileData): void => {
  mkdirSync(dirname(claimPath), { recursive: true });
  writeFileSync(claimPath, `${JSON.stringify(data, null, 2)}\n`);
};

export const removeClaim = (claimPath: string): void => {
  try {
    unlinkSync(claimPath);
  } catch {
    // Already gone -- shutdown cleanup is best-effort and idempotent.
  }
};
