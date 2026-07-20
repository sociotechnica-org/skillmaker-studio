import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { detectHarnesses, registerSkill } from "../src/Harness.ts";
import { withTempDir } from "./support/TestLayer.ts";

describe("detectHarnesses", () => {
  test("reports both harnesses absent in a bare directory", async () => {
    const results = await withTempDir((dir) => detectHarnesses(dir));
    expect(results).toEqual([
      { kind: "claude-code", present: false },
      { kind: "codex", present: false },
    ]);
  });

  test("detects .claude/ presence", async () => {
    const results = await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* fs.makeDirectory(path.join(dir, ".claude"), { recursive: true });
        return yield* detectHarnesses(dir);
      }),
    );
    expect(results).toEqual([
      { kind: "claude-code", present: true },
      { kind: "codex", present: false },
    ]);
  });

  test("detects .codex/ presence", async () => {
    const results = await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* fs.makeDirectory(path.join(dir, ".codex"), { recursive: true });
        return yield* detectHarnesses(dir);
      }),
    );
    expect(results).toEqual([
      { kind: "claude-code", present: false },
      { kind: "codex", present: true },
    ]);
  });
});

describe("registerSkill", () => {
  const CONTENT = "---\nname: skillmaker\n---\nBody.\n";

  test("installs to .claude/skills/skillmaker/SKILL.md when claude-code is present", async () => {
    const results = await withTempDir((dir) =>
      registerSkill(dir, [{ kind: "claude-code", present: true }, { kind: "codex", present: false }], CONTENT),
    );
    expect(results.length).toBe(1);
    expect(results[0]?.kind).toBe("claude-code");
    expect(results[0]?.changed).toBe(true);
    expect(results[0]?.path.replaceAll("\\", "/")).toContain(".claude/skills/skillmaker/SKILL.md");
  });

  test("writes the file with the given content and skips absent harnesses", async () => {
    const outcome = await withTempDir((dir) =>
      Effect.gen(function* () {
        const results = yield* registerSkill(
          dir,
          [{ kind: "claude-code", present: true }, { kind: "codex", present: false }],
          CONTENT,
        );
        const fs = yield* FileSystem;
        const path = yield* Path;
        const written = yield* fs.readFileString(path.join(dir, ".claude", "skills", "skillmaker", "SKILL.md"));
        const codexPathExists = yield* fs.exists(path.join(dir, ".agents", "skills", "skillmaker", "SKILL.md"));
        return { results, written, codexPathExists };
      }),
    );
    expect(outcome.written).toBe(CONTENT);
    expect(outcome.codexPathExists).toBe(false);
    expect(outcome.results.length).toBe(1);
    expect(outcome.results[0]?.kind).toBe("claude-code");
  });

  test("installs to .agents/skills/skillmaker/SKILL.md for codex (not .codex/skills)", async () => {
    const outcome = await withTempDir((dir) =>
      Effect.gen(function* () {
        const results = yield* registerSkill(dir, [{ kind: "codex", present: true }], CONTENT);
        const fs = yield* FileSystem;
        const path = yield* Path;
        const written = yield* fs.readFileString(path.join(dir, ".agents", "skills", "skillmaker", "SKILL.md"));
        return { results, written };
      }),
    );
    expect(outcome.written).toBe(CONTENT);
    expect(outcome.results[0]?.path).toContain(".agents/skills/skillmaker/SKILL.md");
  });

  test("re-running with identical content is a no-op (changed: false)", async () => {
    const outcome = await withTempDir((dir) =>
      Effect.gen(function* () {
        const first = yield* registerSkill(dir, [{ kind: "claude-code", present: true }], CONTENT);
        const second = yield* registerSkill(dir, [{ kind: "claude-code", present: true }], CONTENT);
        return { first, second };
      }),
    );
    expect(outcome.first[0]?.changed).toBe(true);
    expect(outcome.second[0]?.changed).toBe(false);
  });

  test("changed content overwrites and reports changed: true", async () => {
    const outcome = await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* registerSkill(dir, [{ kind: "claude-code", present: true }], CONTENT);
        const second = yield* registerSkill(dir, [{ kind: "claude-code", present: true }], `${CONTENT}more\n`);
        const fs = yield* FileSystem;
        const path = yield* Path;
        const written = yield* fs.readFileString(path.join(dir, ".claude", "skills", "skillmaker", "SKILL.md"));
        return { second, written };
      }),
    );
    expect(outcome.second[0]?.changed).toBe(true);
    expect(outcome.written).toBe(`${CONTENT}more\n`);
  });
});
