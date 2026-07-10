/**
 * Shared test scaffolding: a real filesystem layer (Bun's) rooted at a fresh
 * mkdtemp directory per test.
 */
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TestServices = BunServices.layer;

export const withTempDir = <A, E>(
  run: (dir: string) => Effect.Effect<A, E, FileSystem | Path>,
): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), "skillmaker-core-test-"));
  return Effect.runPromise(run(dir).pipe(Effect.provide(TestServices))).finally(() => {
    rmSync(dir, { recursive: true, force: true });
  });
};
