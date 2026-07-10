/**
 * Resolves the `Actor` for CLI-initiated journal events: `git config
 * user.name`, falling back to `$USER`, falling back to `"unknown"`.
 */
import { Actor } from "@skillmaker/core";
import { Effect } from "effect";

const gitUserName = (): string | undefined => {
  try {
    const result = Bun.spawnSync(["git", "config", "user.name"]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const name = result.stdout.toString().trim();
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
};

export const resolveUserActor = Effect.fn("resolveUserActor")(function* () {
  const name = gitUserName() ?? process.env["USER"] ?? "unknown";
  return Actor.make({ kind: "user", name });
});
