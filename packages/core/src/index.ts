/**
 * @skillmaker/core — v1 domain types.
 *
 * Types only, no logic. Translated from docs/data-model.md (v2 discussion
 * draft, 2026-07-10). The canonical-store split: content lives in files
 * (`skills/<slug>/`), state and decisions live in the append-only journal
 * (`.skillmaker/events.jsonl`), and SQLite is a rebuildable index.
 */

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

/**
 * Provenance for every mutating record: who did it.
 * Inherited law: provenance (Actor) on every mutating record.
 */
export type Actor = {
  kind: "user" | "agent" | "process";
  name: string;
  /** ACP provider id; present when `kind` is `"agent"`. */
  provider?: string;
};

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

/**
 * The production stage ladder for a Skill Bundle.
 * Ruled 2026-07-10 (ruling F). Independent axis from todo status.
 */
export type BundleStage =
  | "idea"
  | "researching"
  | "drafting"
  | "evaluating"
  | "published";

/**
 * `skills/<slug>/bundle.json` — identity only, append-slowly.
 * Nothing mutable-in-anger lives here: no stage, no ready, no status
 * (those are journal replay). The slug is immutable — it keys the journal.
 */
export type BundleIdentity = {
  schemaVersion: 1;
  /** Equals the directory name; kebab-case; immutable. */
  slug: string;
  /** Display name; renames touch this, never the slug. */
  name: string;
  oneLiner: string;
  /** Flat taxonomy (ruling B). */
  tags: string[];
  /** ISO date the bundle was created. */
  created: string;
  /** Advisory: which agents the skill is written for (e.g. "claude-code"). */
  targets: string[];
};

/**
 * Mutable bundle state, materialized by journal replay (never stored as a
 * mutable file — there is no board-state.json descendant).
 */
export type BundleState = {
  slug: string;
  /** Current rung on the stage ladder. */
  stage: BundleStage;
  /** The inherited ready flag; independent of stage. */
  ready: boolean;
  /** Off/on the active board via bundle.archived / bundle.restored. */
  archived: boolean;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The inherited fixture kit classification. */
export type FixtureClass =
  | "golden"
  | "refusal"
  | "empty"
  | "rerun"
  | "hard-case";

/**
 * `skills/<slug>/evals/fixtures/<case>/case.json` — a source artifact:
 * the task plus its classification.
 *
 * Rules carried forward: the answer key is grading-only and never enters
 * the agent's workspace; adversarial fixtures may plant untrusted-input
 * attacks in `files/`.
 */
export type FixtureCase = {
  schemaVersion: 1;
  /** Equals the fixture directory name. */
  case: string;
  class: FixtureClass;
  /** Risk-map ids this case buys coverage for (e.g. "RE-1"). */
  risks: string[];
  /** The task given to the agent. */
  prompt: string;
  setup?: {
    /** Directory (relative to the case) copied into the run workspace. */
    files?: string;
    /** Env vars for the agent process. */
    env?: Record<string, string>;
  };
  /** Optional hints for the human grader. */
  grading?: {
    /** Path to the grading key, e.g. "expected/answer-key.md". */
    answerKey?: string;
    /** Rendered as a checklist in the read-out UI. */
    checks?: string[];
  };
};

// ---------------------------------------------------------------------------
// Skill versions
// ---------------------------------------------------------------------------

/**
 * A recorded skill version. Version = content hash of the output tree:
 * sha256 over the sorted (path, file-sha256) list under `output/`.
 * There is no version file in the bundle — versions live on the journal
 * (`skill.version_recorded`); this is the materialized shape.
 */
export type SkillVersion = {
  bundle: string;
  /** Output-tree content hash, e.g. "sha256:ab12…". */
  hash: string;
  /** design.md hash at record time — feeds the drift hint. */
  designHash: string;
  /** Optional human tag, e.g. "v0.3". */
  label?: string;
  /** ISO timestamp the version was recorded (from the journal event). */
  recordedAt: string;
};

/**
 * The drift hint: live design.md / output/ hashes compared against the
 * latest recorded version. Displayed, never enforced — deliberate
 * hand-finishing is legitimate.
 */
export type DriftStatus =
  | "in-sync"
  | "design-changed"
  | "output-hand-edited"
  | "both";

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Run status. `infra-error` vs `failed` keeps the inherited infra/skill
 * failure split: auth/sandbox/connection faults never pollute pass rates.
 */
export type RunStatus = "running" | "completed" | "failed" | "infra-error";

/**
 * `skills/<slug>/runs/<run-id>/run.json` — a record artifact: written at
 * start, finalized at end, then immutable. A run = one fixture case × one
 * recorded skill version × one provider(+model). A single run is a sample,
 * not a measurement.
 *
 * The grade is NOT here — grading is a decision, so it is a journal event
 * (`run.graded`), which makes regrades naturally append-only history.
 */
export type RunRecord = {
  schemaVersion: 1;
  /** ULID; equals the run directory name. */
  id: string;
  bundle: string;
  fixtureCase: string;
  /** The recorded skill version the run exercised. */
  skillVersionHash: string;
  /** Provider id from skillmaker.config.json (e.g. "claude-code"). */
  provider: string;
  /** Model as reported by the provider. */
  model: string;
  /** ISO timestamp. */
  startedAt: string;
  /** ISO timestamp; absent while status is "running". */
  endedAt?: string;
  status: RunStatus;
  /** Who launched the run. */
  actor: Actor;
};

/** A human grading verdict for a completed run. */
export type RunVerdict = "pass" | "fail" | "partial";

// ---------------------------------------------------------------------------
// Todos
// ---------------------------------------------------------------------------

export type TodoKind = "task" | "bug" | "improvement" | "eval";

/** Terminal statuses: "done" and "wont-do". Status ⊥ bundle stage. */
export type TodoStatus = "open" | "in-progress" | "done" | "wont-do";

/**
 * Journal-native todo, materialized in the DB from `todo.*` events.
 * Sort order: priority → created → id.
 */
export type Todo = {
  /** "td-<ulid>". */
  id: string;
  kind: TodoKind;
  status: TodoStatus;
  title: string;
  detail?: string;
  checklist?: { text: string; done: boolean }[];
  /** Lower = more urgent; defaults: bug 10, eval 15, improvement 20, task 30. */
  priority: number;
  /** App-level todos omit it. */
  bundle?: string;
  /** ISO timestamp. */
  created: string;
  /** Derived at replay: stamped entering a terminal status, cleared on reopen. */
  terminalAt?: string;
  pinned?: boolean;
  /** Derived: terminal + ≥7 days + not pinned. */
  archived?: boolean;
  source: Actor;
};

/** Shallow patch of a todo's mutable fields, carried by `todo.updated`. */
export type TodoPatch = Partial<
  Pick<
    Todo,
    "kind" | "title" | "detail" | "checklist" | "priority" | "bundle" | "pinned"
  >
>;

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

/**
 * Envelope shared by every journal event in `.skillmaker/events.jsonl`.
 * Append rules: validate → idempotency check (same key + same payload ⇒
 * no-op; same key + different payload ⇒ conflict error) → append one line.
 * Writes go only through the CLI/server, never freehand.
 */
export type JournalEnvelope = {
  schemaVersion: 1;
  /** UUID for this event. */
  id: string;
  /** ISO timestamp. */
  at: string;
  actor: Actor;
  idempotencyKey: string;
};

/**
 * The v1 event catalog as a discriminated union on `type`.
 * The journal stays thin — ids and decisions, no fat content. File edits
 * to sources/outputs are not journaled (git is their history).
 */
export type JournalEvent = JournalEnvelope &
  (
    | {
        /** Fired by `skillmaker new`. */
        type: "bundle.created";
        payload: { bundle: string };
      }
    | {
        /** Ladder move; publish requires a prior gate decision. */
        type: "bundle.stage_changed";
        payload: { bundle: string; from: BundleStage; to: BundleStage };
      }
    | {
        type: "bundle.ready_changed";
        payload: { bundle: string; ready: boolean };
      }
    | {
        type: "bundle.gate_decided";
        payload: {
          bundle: string;
          /** One publish gate (ruling C). */
          gate: "publish";
          decision: "approved" | "declined";
          /** Free-text evidence summary shown in history. */
          basis: string;
        };
      }
    | {
        /** Off the active board. */
        type: "bundle.archived";
        payload: { bundle: string };
      }
    | {
        /** Back on the active board. */
        type: "bundle.restored";
        payload: { bundle: string };
      }
    | {
        type: "skill.version_recorded";
        payload: {
          bundle: string;
          /** Output-tree content hash. */
          hash: string;
          /** design.md hash at record time → drift hint. */
          designHash: string;
          /** Optional human tag, e.g. "v0.3". */
          label?: string;
        };
      }
    | {
        type: "skill.published";
        payload: {
          bundle: string;
          versionHash: string;
          /** Publish-target id from skillmaker.config.json. */
          target: string;
          url?: string;
        };
      }
    | {
        /** Carries the full todo record. */
        type: "todo.opened";
        payload: { todo: Todo };
      }
    | {
        /** Shallow patch of mutable fields. */
        type: "todo.updated";
        payload: { id: string; patch: TodoPatch };
      }
    | {
        /** Terminal stamping (terminalAt) is derived at replay. */
        type: "todo.status_changed";
        payload: { id: string; from: TodoStatus; to: TodoStatus };
      }
    | {
        /** Mirrors run.json (minus end fields) for replay-completeness. */
        type: "run.started";
        payload: { run: Omit<RunRecord, "endedAt"> };
      }
    | {
        type: "run.completed";
        payload: { id: string; status: RunStatus; endedAt: string };
      }
    | {
        /** Regrade = new event; latest wins, history kept. */
        type: "run.graded";
        payload: {
          id: string;
          verdict: RunVerdict;
          /** Mirrors case.json grading.checks as graded checkboxes. */
          checks?: { text: string; pass: boolean }[];
          notes?: string;
        };
      }
  );

/** The v1 journal event type names. */
export type JournalEventType = JournalEvent["type"];
