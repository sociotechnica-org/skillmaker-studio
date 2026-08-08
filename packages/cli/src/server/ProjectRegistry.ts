/**
 * The server's live view of the machine-level project registry (director
 * rulings 2026-07-27): reads `<home>/config.json` through core's
 * MachineConfig module, derives each project's URL slug + display name, and
 * owns the PER-PROJECT server resources -- chat session manager, run
 * dispatch queue, journal watcher. `refresh()` diffs registered paths
 * against live contexts, so adding/removing a project at runtime spins
 * resources up/down without a server restart.
 *
 * A registered directory that is missing or carries a broken
 * `skillmaker.config.json` becomes a `broken` context: reported (never
 * crashed over), listed with its error, and refusing project-scoped routes
 * with an honest 503 -- the registry tolerates a moved/deleted project
 * gracefully, per the IA doc.
 */
import {
  computeProjectSlugs,
  readMachineConfig,
  WorkspaceConfig,
  DEFAULT_CONFIG_FILENAME,
} from "@skillmaker/core";
import { Schema } from "effect";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { ChatSessionManager } from "./ChatSessions.ts";
import { createRunDispatchHandlers } from "./RunDispatch.ts";
import { watchJournal, type JournalWatcherHandle } from "./JournalWatcher.ts";

export type RunDispatchHandlers = ReturnType<typeof createRunDispatchHandlers>;

export interface OkProjectContext {
  readonly kind: "ok";
  readonly slug: string;
  readonly root: string;
  readonly name: string;
  readonly config: WorkspaceConfig;
  readonly chat: ChatSessionManager;
  readonly runDispatch: RunDispatchHandlers;
}

export interface BrokenProjectContext {
  readonly kind: "broken";
  readonly slug: string;
  readonly root: string;
  /** Derived at read time like every name: the directory basename (a broken project has no readable config to name itself with). */
  readonly name: string;
  readonly error: string;
}

export type ProjectContext = OkProjectContext | BrokenProjectContext;

interface LiveEntry {
  readonly context: ProjectContext;
  readonly watcher?: JournalWatcherHandle;
}

/** Reads and decodes one project's own `skillmaker.config.json`, or explains why it can't. */
const loadProjectConfig = (
  root: string,
): { readonly kind: "ok"; readonly config: WorkspaceConfig } | { readonly kind: "error"; readonly error: string } => {
  if (!existsSync(root)) {
    return { kind: "error", error: "directory does not exist" };
  }
  try {
    if (!statSync(root).isDirectory()) {
      return { kind: "error", error: "not a directory" };
    }
  } catch (cause) {
    return { kind: "error", error: `could not stat: ${String(cause)}` };
  }
  const configPath = join(root, DEFAULT_CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    return { kind: "error", error: `no ${DEFAULT_CONFIG_FILENAME} (not a skillmaker workspace)` };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    return { kind: "ok", config: Schema.decodeUnknownSync(WorkspaceConfig)(parsed) };
  } catch (cause) {
    return { kind: "error", error: `invalid ${DEFAULT_CONFIG_FILENAME}: ${String(cause)}` };
  }
};

export interface ProjectRegistryManagerOptions {
  readonly home: string;
  /** Called (debounced per project by the watcher) when a project's journal changes; the payload carries WHICH project. */
  readonly onJournalChange: (slug: string) => void;
}

export class ProjectRegistryManager {
  private readonly home: string;
  private readonly onJournalChange: (slug: string) => void;
  /** Live contexts keyed by registered ABSOLUTE PATH (the registry's own identity), not slug -- slugs can change when a colliding basename arrives. */
  private readonly live = new Map<string, LiveEntry>();

  constructor(options: ProjectRegistryManagerOptions) {
    this.home = options.home;
    this.onJournalChange = options.onJournalChange;
    this.refresh();
  }

  /**
   * Re-reads the registry and reconciles: new paths get contexts (+ per-ok
   * resources), removed paths get disposed, kept paths keep their live
   * resources (an in-flight chat session survives an unrelated project
   * add). A kept-but-broken project is re-probed each refresh so fixing the
   * directory heals it on the next registry mutation or server restart.
   */
  refresh(): void {
    const registered = readMachineConfig(this.home).projects.map((entry) => entry.path);
    const slugs = computeProjectSlugs(registered);
    const registeredSet = new Set(registered);

    for (const [path, entry] of this.live) {
      if (!registeredSet.has(path)) {
        entry.watcher?.close();
        if (entry.context.kind === "ok") {
          void entry.context.chat.stop();
        }
        this.live.delete(path);
      }
    }

    for (const path of registered) {
      const slug = slugs.get(path) as string;
      const existing = this.live.get(path);
      // A live ok context stays live only while its directory still looks
      // like a workspace -- a moved/deleted project degrades to `broken` on
      // the next reconcile instead of 500ing route by route.
      if (
        existing !== undefined &&
        existing.context.kind === "ok" &&
        existsSync(join(path, DEFAULT_CONFIG_FILENAME))
      ) {
        if (existing.context.slug !== slug) {
          // Same live resources, new slug (a colliding basename arrived).
          this.live.set(path, {
            watcher: existing.watcher,
            context: { ...existing.context, slug },
          });
        }
        continue;
      }
      existing?.watcher?.close();
      if (existing?.context.kind === "ok") {
        void existing.context.chat.stop();
      }

      const loaded = loadProjectConfig(path);
      if (loaded.kind === "error") {
        this.live.set(path, {
          context: { kind: "broken", slug, root: path, name: basename(path), error: loaded.error },
        });
        continue;
      }
      const config = loaded.config;
      const name = config.name.length > 0 ? config.name : basename(path);
      const journalPath = join(path, ".skillmaker", "events.jsonl");
      const watcher = watchJournal(journalPath, () => {
        // Slug is re-read from the live map at fire time so a renamed slug
        // never broadcasts under its stale name.
        const current = this.live.get(path);
        if (current !== undefined) {
          this.onJournalChange(current.context.slug);
        }
      });
      this.live.set(path, {
        watcher,
        context: {
          kind: "ok",
          slug,
          root: path,
          name,
          config,
          chat: new ChatSessionManager({ root: path, config, onWorkChanged: () => this.onJournalChange(slug) }),
          runDispatch: createRunDispatchHandlers({ root: path, config }),
        },
      });
    }
  }

  /** Every registered project's context, in registry order. */
  contexts(): ReadonlyArray<ProjectContext> {
    const registered = readMachineConfig(this.home).projects.map((entry) => entry.path);
    return registered
      .map((path) => this.live.get(path)?.context)
      .filter((context): context is ProjectContext => context !== undefined);
  }

  bySlug(slug: string): ProjectContext | undefined {
    for (const entry of this.live.values()) {
      if (entry.context.slug === slug) {
        return entry.context;
      }
    }
    return undefined;
  }

  isRegistered(path: string): boolean {
    return this.live.has(path);
  }

  /** The first healthy project, if any -- machine-level endpoints that need SOME workspace (the chat provider catalog) use this. */
  firstOk(): OkProjectContext | undefined {
    for (const context of this.contexts()) {
      if (context.kind === "ok") {
        return context;
      }
    }
    return undefined;
  }

  async stop(): Promise<void> {
    for (const entry of this.live.values()) {
      entry.watcher?.close();
      if (entry.context.kind === "ok") {
        await entry.context.chat.stop();
      }
    }
    this.live.clear();
  }
}
