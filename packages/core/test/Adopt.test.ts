import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { createHash } from "node:crypto";
import { AdoptMarker, adoptWorkspace, parseFrontmatter } from "../src/Adopt.ts";
import { computeBundleHashes, hashOutputTree } from "../src/Versions.ts";
import { withTempDir } from "./support/TestLayer.ts";

const write = (dir: string, relativePath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;
    const full = path.join(dir, relativePath);
    yield* fs.makeDirectory(path.dirname(full), { recursive: true });
    yield* fs.writeFileString(full, content);
  });

const skillMd = (name: string, description = "does the thing", extra = ""): string =>
  `---
name: ${name}
description: ${description}
${extra}---
# ${name}

Body content.
`;

describe("parseFrontmatter", () => {
  test("parses standard name/description", () => {
    const { data, warnings } = parseFrontmatter(skillMd("browse", "browse the web"));
    expect(data["name"]).toBe("browse");
    expect(data["description"]).toBe("browse the web");
    expect(warnings).toEqual([]);
  });

  test("preserves unknown/nonstandard keys and warns about each", () => {
    const content = `---
name: ask-matt
description: routes questions
disable-model-invocation: true
version: 1.2.0
triggers: [ask, question]
---
Body.
`;
    const { data, warnings } = parseFrontmatter(content);
    expect(data["disable-model-invocation"]).toBe(true);
    expect(data["version"]).toBe("1.2.0");
    expect(data["triggers"]).toEqual(["ask", "question"]);
    expect(warnings).toContain('nonstandard frontmatter key "disable-model-invocation" preserved, not applied');
    expect(warnings).toContain('nonstandard frontmatter key "version" preserved, not applied');
    expect(warnings).toContain('nonstandard frontmatter key "triggers" preserved, not applied');
  });

  test("block-style array frontmatter", () => {
    const content = `---
name: foo
tags:
  - alpha
  - beta
---
Body.
`;
    const { data } = parseFrontmatter(content);
    expect(data["tags"]).toEqual(["alpha", "beta"]);
  });

  test("missing frontmatter block warns and returns empty data", () => {
    const { data, warnings } = parseFrontmatter("# Just a heading\n\nNo frontmatter here.\n");
    expect(data).toEqual({});
    expect(warnings.length).toBe(1);
  });

  test("a leading AUTO-GENERATED HTML comment banner doesn't block frontmatter parsing (gstack shape)", () => {
    const content = `<!-- AUTO-GENERATED from SKILL.md.tmpl -- do not edit directly -->
---
name: deploy
description: deploy the app
version: 2.1.0
---
# deploy
`;
    const { data } = parseFrontmatter(content);
    expect(data["name"]).toBe("deploy");
    expect(data["version"]).toBe("2.1.0");
  });
});

describe("adoptWorkspace: discovery", () => {
  test("finds a flat <name>/SKILL.md at repo root (gstack shape)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));

        const report = yield* adoptWorkspace(dir);
        expect(report.found).toBe(1);
        expect(report.adopted.length).toBe(1);
        expect(report.adopted[0]?.slug).toBe("browse");

        const bundleJsonExists = yield* fs.exists(path.join(dir, "browse", "bundle.json"));
        const markerExists = yield* fs.exists(path.join(dir, "browse", ".skillmaker-adopt.json"));
        expect(bundleJsonExists).toBe(true);
        expect(markerExists).toBe(true);
      }),
    );
  });

  test("finds nested skills/<category>/<name>/SKILL.md (mattpocock shape)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "skills/engineering/diagnosing-bugs/SKILL.md", skillMd("diagnosing-bugs"));
        yield* write(dir, "skills/productivity/note-taking/SKILL.md", skillMd("note-taking"));

        const report = yield* adoptWorkspace(dir);
        expect(report.found).toBe(2);
        expect(report.adopted.map((s) => s.slug).sort()).toEqual(["diagnosing-bugs", "note-taking"]);
      }),
    );
  });

  test("finds .agents/skills/<name>/SKILL.md (elicit/codex shape)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, ".agents/skills/aikido/SKILL.md", skillMd("aikido"));
        yield* write(dir, ".agents/skills/aikido/get-token.sh", "#!/bin/sh\necho token\n");

        const report = yield* adoptWorkspace(dir);
        expect(report.found).toBe(1);
        expect(report.adopted[0]?.slug).toBe("aikido");
      }),
    );
  });

  test("skips node_modules, .git, and dist entirely", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "node_modules/some-pkg/SKILL.md", skillMd("fake"));
        yield* write(dir, ".git/SKILL.md", skillMd("fake2"));
        yield* write(dir, "dist/SKILL.md", skillMd("fake3"));
        yield* write(dir, "real-skill/SKILL.md", skillMd("real-skill"));

        const report = yield* adoptWorkspace(dir);
        expect(report.found).toBe(1);
        expect(report.adopted[0]?.slug).toBe("real-skill");
      }),
    );
  });

  test("skips a directory that already has bundle.json (idempotent re-adopt)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));

        const first = yield* adoptWorkspace(dir);
        expect(first.adopted.length).toBe(1);
        expect(first.skipped.length).toBe(0);

        // A brand-new SKILL.md appears alongside the already-adopted one.
        yield* write(dir, "review/SKILL.md", skillMd("review"));

        const second = yield* adoptWorkspace(dir);
        expect(second.found).toBe(2);
        expect(second.adopted.length).toBe(1);
        expect(second.adopted[0]?.slug).toBe("review");
        expect(second.skipped.length).toBe(1);
        expect(second.skipped[0]?.reason).toBe("already-adopted");
      }),
    );
  });

  test("slug collisions get a numeric suffix", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "a/browse/SKILL.md", skillMd("browse"));
        yield* write(dir, "b/browse/SKILL.md", skillMd("browse"));

        const report = yield* adoptWorkspace(dir);
        const slugs = report.adopted.map((s) => s.slug).sort();
        expect(slugs).toEqual(["browse", "browse-2"]);
      }),
    );
  });
});

describe("adoptWorkspace: lifecycle from pathnames", () => {
  test("deprecated/ maps to archived lifecycle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "skills/deprecated/old-thing/SKILL.md", skillMd("old-thing"));

        const report = yield* adoptWorkspace(dir);
        expect(report.adopted[0]?.lifecycle).toBe("archived");
      }),
    );
  });

  test("in-progress/ maps to idea lifecycle with a warning note", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "skills/in-progress/half-baked/SKILL.md", skillMd("half-baked"));

        const report = yield* adoptWorkspace(dir);
        const skill = report.adopted[0];
        expect(skill?.lifecycle).toBe("idea");
        expect(skill?.warnings.some((w) => w.includes("in-progress"))).toBe(true);
      }),
    );
  });
});

describe("adoptWorkspace: generated SKILL.md detection", () => {
  test("flags an AUTO-GENERATED SKILL.md paired with a .tmpl source (gstack shape)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const generatedContent = `<!-- AUTO-GENERATED from SKILL.md.tmpl -- do not edit directly -->
---
name: browse
description: browse the web
version: 1.2.0
---
# browse
`;
        yield* write(dir, "browse/SKILL.md", generatedContent);
        yield* write(dir, "browse/SKILL.md.tmpl", "---\nname: browse\n---\n# browse (template)\n");

        const report = yield* adoptWorkspace(dir);
        const skill = report.adopted[0];
        expect(skill?.generated).toBe(true);
        expect(skill?.warnings.some((w) => w.toLowerCase().includes("generated"))).toBe(true);

        const markerRaw = yield* fs.readFileString(path.join(dir, "browse", ".skillmaker-adopt.json"));
        const marker = JSON.parse(markerRaw) as { generated: boolean };
        expect(marker.generated).toBe(true);
      }),
    );
  });

  test("a normal hand-authored SKILL.md is not flagged generated", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));

        const report = yield* adoptWorkspace(dir);
        expect(report.adopted[0]?.generated).toBe(false);
      }),
    );
  });
});

describe("adoptWorkspace: manifest and eval-infra detection", () => {
  test("detects a mattpocock-style plugin.json index (report-only, not written to)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* write(dir, ".claude-plugin/plugin.json", JSON.stringify({ name: "x", skills: [] }));
        yield* write(dir, "skills/engineering/foo/SKILL.md", skillMd("foo"));

        const before = yield* fs.readFileString(path.join(dir, ".claude-plugin", "plugin.json"));
        const report = yield* adoptWorkspace(dir);
        const after = yield* fs.readFileString(path.join(dir, ".claude-plugin", "plugin.json"));

        expect(report.manifests.some((m) => m.relativePath.includes("plugin.json"))).toBe(true);
        expect(after).toBe(before);
      }),
    );
  });

  test("detects evals/ and tests/ directories as report-only eval infra", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        yield* write(dir, "evals/golden.yml", "cases: []\n");
        yield* write(dir, "tests/foo.test.ts", "test();\n");
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));

        const report = yield* adoptWorkspace(dir);
        const kinds = report.evalInfra.map((e) => e.kind).sort();
        expect(kinds).toEqual(["evals", "tests"]);
      }),
    );
  });
});

describe("in-place output hashing", () => {
  test("hashOutputTree excludes studio-owned names for an in-place bundle", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));
        yield* write(dir, "browse/scripts/run.sh", "#!/bin/sh\n");

        // Hash before adopt (raw content: SKILL.md + scripts/run.sh).
        const before = yield* hashOutputTree(path.join(dir, "browse"));

        yield* adoptWorkspace(dir);

        // Hash after adopt, excluding studio-owned names, must match the
        // pre-adopt hash: bundle.json/marker/design.md/research/evals/runs
        // are additive, not content the brownfield repo authored.
        const after = yield* hashOutputTree(path.join(dir, "browse"), {
          excludeTopLevel: new Set(["bundle.json", ".skillmaker-adopt.json", "design.md", "research", "evals", "runs"]),
        });

        expect(after).toBe(before);
      }),
    );
  });

  test("computeBundleHashes(dir, \"in-place\") matches the exclusion-based hash", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const path = yield* Path;
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));
        yield* write(dir, "browse/references/api.md", "# API\n");

        yield* adoptWorkspace(dir);

        const bundleDir = path.join(dir, "browse");
        const hashes = yield* computeBundleHashes(bundleDir, "in-place");

        // design.md doesn't exist for an in-place bundle -- hashes the empty string.
        const emptyDesignHash = `sha256:${createHash("sha256").update("").digest("hex")}`;
        expect(hashes.designHash).toBe(emptyDesignHash);

        // Re-running the hash must be stable (no drift from a no-op reindex).
        const again = yield* computeBundleHashes(bundleDir, "in-place");
        expect(again.outputHash).toBe(hashes.outputHash);
      }),
    );
  });
});

describe("adoptWorkspace: upstream provenance (Fix, Phase 20 Story 3 friction log)", () => {
  test("adopt --source stamps upstream.source + importedAt on every skill adopted in that batch", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));
        yield* write(dir, "deploy/SKILL.md", skillMd("deploy"));

        const report = yield* adoptWorkspace(dir, { source: "https://github.com/example/skills-repo" });
        expect(report.adopted.length).toBe(2);

        for (const skill of report.adopted) {
          const markerPath = path.join(skill.dir, ".skillmaker-adopt.json");
          const raw = yield* fs.readFileString(markerPath);
          const parsed = yield* Effect.try({
            try: () => JSON.parse(raw) as unknown,
            catch: (cause) => cause,
          });
          const marker = yield* Schema.decodeUnknownEffect(AdoptMarker)(parsed);
          expect(marker.upstream?.source).toBe("https://github.com/example/skills-repo");
          expect(marker.upstream?.ref).toBeUndefined();
          expect(marker.upstream?.importedAt).toBeDefined();
        }
      }),
    );
  });

  test("adopt --source --ref records both", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));

        yield* adoptWorkspace(dir, { source: "/local/skills-repo", ref: "v2.3.0" });

        const markerPath = path.join(dir, "browse", ".skillmaker-adopt.json");
        const raw = yield* fs.readFileString(markerPath);
        const parsed = JSON.parse(raw) as { upstream?: { source: string; ref?: string } };
        expect(parsed.upstream?.source).toBe("/local/skills-repo");
        expect(parsed.upstream?.ref).toBe("v2.3.0");
      }),
    );
  });

  test("adopt without --source never adds an upstream key at all (not even null)", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        yield* write(dir, "browse/SKILL.md", skillMd("browse"));

        yield* adoptWorkspace(dir);

        const markerPath = path.join(dir, "browse", ".skillmaker-adopt.json");
        const raw = yield* fs.readFileString(markerPath);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect("upstream" in parsed).toBe(false);
      }),
    );
  });

  test("a pre-fix marker (no upstream key at all) still decodes cleanly", async () => {
    await withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const bundleDir = path.join(dir, "browse");
        yield* fs.makeDirectory(bundleDir, { recursive: true });
        const preFixMarker = {
          schemaVersion: 1,
          adoptedAt: "2026-01-01T00:00:00.000Z",
          layout: "in-place",
          skillPath: "SKILL.md",
          generated: false,
          frontmatter: {},
        };
        yield* fs.writeFileString(
          path.join(bundleDir, ".skillmaker-adopt.json"),
          `${JSON.stringify(preFixMarker, null, 2)}\n`,
        );

        const raw = yield* fs.readFileString(path.join(bundleDir, ".skillmaker-adopt.json"));
        const parsed = JSON.parse(raw) as unknown;
        const decoded = yield* Schema.decodeUnknownEffect(AdoptMarker)(parsed);
        expect(decoded.upstream).toBeUndefined();
      }),
    );
  });
});
