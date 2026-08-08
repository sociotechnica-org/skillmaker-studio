/**
 * The Workspace service: resolving a workspace root, initializing one, and
 * scaffolding a new Skill Bundle (data-model.md §2.1).
 */
import { Context, Effect, Layer, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { BundleIdentity } from "./Bundle.ts";
import { BundleExistsError, InvalidSlugError, WorkspaceIOError, WorkspaceNotFoundError } from "./Errors.ts";
import { DEFAULT_STATIONS_TEMPLATE, StationsFile } from "./Stations.ts";
import {
  DEFAULT_CONFIG_FILENAME,
  ResolvedWorkspace,
  WorkspaceConfig,
  defaultConfig,
} from "./Workspace.ts";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const isValidSlug = (slug: string): boolean => SLUG_PATTERN.test(slug);

const toIOError = (message: string) => (cause: unknown) =>
  WorkspaceIOError.make({ message, cause });

/** Today's date as YYYY-MM-DD, for `bundle.json.created`. */
const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

/** kebab-case slug -> "Title Cased Name". */
const titleCaseFromSlug = (slug: string): string =>
  slug
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const designMdSkeleton = (slug: string): string =>
  `---
bundle: ${slug}
---
# Design — ${titleCaseFromSlug(slug)}

## Intent
<!-- What outcome this skill produces and for whom. -->

## When to use / triggers
<!-- The situations that should activate it (seeds SKILL.md's description). -->

## The workflow
<!-- The step-by-step logic, in prose. Numbered steps, decision points,
     what the agent must never do. -->

## Failure hypotheses
<!-- | # | How it could fail | Risk family | -->

## Proof spec
<!-- Which fixture cases the failure hypotheses demand (seeds evals/). -->
`;

const riskMapSkeleton = (slug: string): string =>
  `---
bundle: ${slug}
---
<!-- The authored coverage axis ONLY (data-model.md §2.6) -- no results
     column, ever: validation is computed from graded runs and joined in the
     viewer at read time. Risk ids band into IN (input) / RE (reasoning) /
     OUT (output) / ADV (adversarial) / CHN (chain) families. Coverage is
     ● covered / ◐ partial / ○ gap (or the plain words). Fixture is the
     evals/fixtures/<case>/ directory name that buys this row's coverage, or
     "—" for a gap. -->

| Risk | Description | Coverage | Fixture |
|---|---|---|---|
`;

export interface CreateBundleInput {
  readonly slug: string;
  readonly name?: string;
}

export class Workspace extends Context.Service<
  Workspace,
  {
    readonly resolve: (
      cwd: string,
    ) => Effect.Effect<ResolvedWorkspace, WorkspaceNotFoundError | WorkspaceIOError>;
    readonly init: (
      cwd: string,
    ) => Effect.Effect<
      { readonly status: "initialized" | "already_initialized"; readonly root: string },
      WorkspaceIOError
    >;
    readonly createBundle: (
      root: string,
      input: CreateBundleInput,
    ) => Effect.Effect<
      { readonly status: "created" | "already_exists"; readonly slug: string },
      InvalidSlugError | WorkspaceIOError
    >;
  }
>()("Workspace") {}

export const layer: Layer.Layer<Workspace, never, FileSystem | Path> = Layer.effect(Workspace)(
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = yield* Path;

    const configPathFor = (dir: string) => path.join(dir, DEFAULT_CONFIG_FILENAME);

    const resolve = Effect.fn("Workspace.resolve")(function* (cwd: string) {
      let dir = path.resolve(cwd);
      while (true) {
        const candidate = configPathFor(dir);
        const exists = yield* fs
          .exists(candidate)
          .pipe(Effect.mapError(toIOError(`could not check ${candidate}`)));
        if (exists) {
          const raw = yield* fs
            .readFileString(candidate)
            .pipe(Effect.mapError(toIOError(`could not read ${candidate}`)));
          const parsed = yield* Effect.try({
            try: () => JSON.parse(raw) as unknown,
            catch: toIOError(`invalid JSON in ${candidate}`),
          });
          const config = yield* Schema.decodeUnknownEffect(WorkspaceConfig)(parsed).pipe(
            Effect.mapError(toIOError(`invalid workspace config in ${candidate}`)),
          );
          return ResolvedWorkspace.make({ root: dir, config });
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
          return yield* Effect.fail(WorkspaceNotFoundError.make({ cwd }));
        }
        dir = parent;
      }
    });

    const init = Effect.fn("Workspace.init")(function* (cwd: string) {
      const root = path.resolve(cwd);
      const configPath = configPathFor(root);
      const alreadyExists = yield* fs
        .exists(configPath)
        .pipe(Effect.mapError(toIOError(`could not check ${configPath}`)));
      if (alreadyExists) {
        return { status: "already_initialized" as const, root };
      }

      const name = path.basename(root);
      const config = defaultConfig(name);

      yield* fs
        .writeFileString(configPath, `${JSON.stringify(config, null, 2)}\n`)
        .pipe(Effect.mapError(toIOError(`could not write ${configPath}`)));

      const skillmakerDir = path.join(root, ".skillmaker");
      yield* fs
        .makeDirectory(skillmakerDir, { recursive: true })
        .pipe(Effect.mapError(toIOError(`could not create ${skillmakerDir}`)));

      const journalPath = path.join(skillmakerDir, "events.jsonl");
      const journalExists = yield* fs
        .exists(journalPath)
        .pipe(Effect.mapError(toIOError(`could not check ${journalPath}`)));
      if (!journalExists) {
        yield* fs
          .writeFileString(journalPath, "")
          .pipe(Effect.mapError(toIOError(`could not create ${journalPath}`)));
      }

      const skillsDir = path.join(root, config.skillsDir);
      yield* fs
        .makeDirectory(skillsDir, { recursive: true })
        .pipe(Effect.mapError(toIOError(`could not create ${skillsDir}`)));

      return { status: "initialized" as const, root };
    });

    const createBundle = Effect.fn("Workspace.createBundle")(function* (
      root: string,
      input: CreateBundleInput,
    ) {
      if (!isValidSlug(input.slug)) {
        return yield* Effect.fail(InvalidSlugError.make({ slug: input.slug }));
      }

      const configPath = configPathFor(root);
      const raw = yield* fs
        .readFileString(configPath)
        .pipe(Effect.mapError(toIOError(`could not read ${configPath}`)));
      const parsed = yield* Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: toIOError(`invalid JSON in ${configPath}`),
      });
      const config = yield* Schema.decodeUnknownEffect(WorkspaceConfig)(parsed).pipe(
        Effect.mapError(toIOError(`invalid workspace config in ${configPath}`)),
      );

      const bundleDir = path.join(root, config.skillsDir, input.slug);
      const alreadyExists = yield* fs
        .exists(bundleDir)
        .pipe(Effect.mapError(toIOError(`could not check ${bundleDir}`)));
      if (alreadyExists) {
        return { status: "already_exists" as const, slug: input.slug };
      }

      const identity = BundleIdentity.make({
        schemaVersion: 1,
        slug: input.slug,
        name: input.name ?? titleCaseFromSlug(input.slug),
        oneLiner: "",
        tags: [],
        created: todayIsoDate(),
        targets: ["claude-code"],
      });

      yield* fs
        .makeDirectory(bundleDir, { recursive: true })
        .pipe(Effect.mapError(toIOError(`could not create ${bundleDir}`)));

      yield* fs
        .writeFileString(
          path.join(bundleDir, "bundle.json"),
          `${JSON.stringify(identity, null, 2)}\n`,
        )
        .pipe(Effect.mapError(toIOError("could not write bundle.json")));

      const stations = StationsFile.make(DEFAULT_STATIONS_TEMPLATE);
      yield* fs
        .writeFileString(
          path.join(bundleDir, "stations.json"),
          `${JSON.stringify(stations, null, 2)}\n`,
        )
        .pipe(Effect.mapError(toIOError("could not write stations.json")));

      yield* fs
        .writeFileString(path.join(bundleDir, "design.md"), designMdSkeleton(input.slug))
        .pipe(Effect.mapError(toIOError("could not write design.md")));

      const dirsWithGitkeep = [
        "research",
        path.join("evals", "fixtures"),
        "output",
        "runs",
      ];
      for (const relativeDir of dirsWithGitkeep) {
        const dir = path.join(bundleDir, relativeDir);
        yield* fs
          .makeDirectory(dir, { recursive: true })
          .pipe(Effect.mapError(toIOError(`could not create ${dir}`)));
        yield* fs
          .writeFileString(path.join(dir, ".gitkeep"), "")
          .pipe(Effect.mapError(toIOError(`could not write ${dir}/.gitkeep`)));
      }

      yield* fs
        .writeFileString(path.join(bundleDir, "evals", "risk-map.md"), riskMapSkeleton(input.slug))
        .pipe(Effect.mapError(toIOError("could not write evals/risk-map.md")));

      return { status: "created" as const, slug: input.slug };
    });

    return { resolve, init, createBundle };
  }),
);
