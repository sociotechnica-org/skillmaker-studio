/**
 * The skill card (issue #109, data-model draft "The Card"): the per-skill
 * projection that replaces the old bundle panel (`BundlePanel.tsx`), wired
 * to the SAME `GET /api/bundles/<slug>` payload. One noun, rendered at
 * home: derived, never stale, never stored. Card charter, non-negotiable:
 * **display before derivation, derivation before automation** -- v1 shows
 * only what the data already backs.
 *
 * Layout (card-fidelity round, visual target `.context/card-v1/card-v1.html`):
 * one card OBJECT -- strong border, amber accent strip, offset shadow,
 * footer stamp -- reading as a physical index card, not a flat panel.
 * Always visible: the prototype header (eyebrow · mono slug · one-liner ·
 * tags | stage·version + drift badges) and the 3-cell glance strip
 * (Proven on / Coverage / Version). Then file-folder tabs over a bordered
 * "page", and BELOW the page an always-visible "Next, from what we already
 * know" chip strip (derivable-today gaps only, `runtime/cardGlance.ts`):
 *  - **Overview**: a plain-language status line, the Facts mini-table +
 *    Pipeline (neighborhood) block, and -- grouped under one "Actions"
 *    area so they stop dominating -- every action affordance the old panel
 *    had (review pair, publish gate, stage advance/back, station run,
 *    publish-to-targets, recent events). The card replaces the panel's
 *    layout, not its capabilities.
 *  - **Instructions**: the skill ITSELF -- the shipped SKILL.md (the
 *    server-derived `instructionsPath`: `output/SKILL.md`, or `SKILL.md`
 *    for in-place bundles) rendered read-only via the existing file
 *    endpoint, bound honestly to the recorded version + drift state. The
 *    card's readable payload: without this tab the card showed everything
 *    *about* the skill and never the skill.
 *  - **Models**: the measurements table -- one row per (fixture × provider ×
 *    model × version), NEVER pooled (data-model.md §1.1 laws 5-6), exact
 *    pinned model ids as recorded, n · pass · rate · 95% CI (computed in
 *    core: Wilson / rule-of-three on the real n), every row pinned to the
 *    version it measured. The fixtures/runs read-out (Run buttons, run
 *    detail modal, `?run=` deep link) lives here too.
 *  - **Coverage**: the risk map in its authored words (covered / partial /
 *    gap) -- authored judgment kept visually separate from pass rates,
 *    which live in Models. Never blended.
 *  - **Research**: the dossier, honest gaps shown explicitly ("Job:
 *    unrecorded", "Contexts: none named") -- never hidden.
 *  - **Lineage**: chain of custody replayed from the journal (server-derived
 *    `lineage.custody`) + fork family (marker-derived `forkOf`/`forks`/
 *    `upstream`) + version records (drift, "Record version", history --
 *    versions ARE custody, so the old Versions tab lives here; its old path
 *    aliases in via the router).
 *  - **Files**: the read-only source review, unchanged (`?file=` deep links).
 *
 * Filed for vN, deliberately NOT built: risk heat map, world-watch,
 * neighborhood scoring, card.json interchange. Unverified stays a badge,
 * never a band.
 */
import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import {
  type PostEventInput,
  postEvent,
  publishBundle,
  recordVersion,
  triggerRun,
  triggerStationRun,
} from "../runtime/api.ts";
import { coverageTally, formatCI, formatPassRate, modelDisplayName, nextChips, providerModelId, provenOnProviders } from "../runtime/cardGlance.ts";
import { formatDay, formatTimestamp } from "../runtime/dates.ts";
import {
  bundleFileHref,
  bundleFixtureHref,
  bundleHref,
  bundleRunHref,
  Link,
  type BundleTab,
  type CardOrigin,
  useRouter,
} from "../runtime/router.tsx";
import {
  RETIRED_BADGE_CLASS,
  STAGES,
  STAGE_BADGE_CLASS,
  STAGE_LABEL,
  UNVERIFIED_BADGE_CLASS,
  type BundleStage,
  type CoverageValue,
  type DossierRecord,
  type Drift,
  type EventView,
  type FixtureRecord,
  type LineageRecord,
  type MeasurementRecord,
  type PublishTargetResult,
  type RiskCoverageRecord,
  type RunRecord,
  type VersionRecord,
  type WarningRecord,
} from "../runtime/schemas.ts";
import { useBundleDetail } from "../runtime/useBundleDetail.ts";
import { useBundleFileContent } from "../runtime/useBundleFileContent.ts";
import { FileContentView } from "./Markdown.tsx";
import { useFixtureDetail } from "../runtime/useFixtureDetail.ts";
import { useWorkspace } from "../runtime/useWorkspace.ts";
import { nextAction, nextStageOf } from "../runtime/nextAction.ts";
import { latestReviewOutcome, pendingReview, type ReviewOutcome } from "../runtime/reviewPanel.ts";
import { Badge } from "./Badge.tsx";
import { RunDetailModal } from "./RunDetailModal.tsx";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringField = (payload: unknown, key: string): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
};

const earlierStages = (stage: BundleStage): ReadonlyArray<BundleStage> => STAGES.slice(0, STAGES.indexOf(stage));

/** A plain-language status line for the top of Overview -- replaces the raw stage/substate/guard-booleans dump. */
const statusLineFor = (stage: BundleStage, substate: string, forwardReady: boolean): string => {
  if (stage === "published") return "Published — this skill has shipped.";
  if (substate === "awaiting-review") return "Ready for your review.";
  if (stage === "evaluating") return "In evaluation — clear the publish gate to ship.";
  if (forwardReady) {
    const next = nextStageOf(stage);
    return next === undefined ? "Ready to move on." : `Approved — ready to move to ${STAGE_LABEL[next]}.`;
  }
  return `${STAGE_LABEL[stage]} — in progress.`;
};

/**
 * A `bundle.stage_changed` event's from→to + reason, for the Overview's
 * recent-events rows (seam pass over #108/#109): without this, a recorded
 * reason -- most notably triage's "entry stage derived from runnable
 * output" (issue #108) -- was journaled but rendered nowhere on the card.
 * Generic on purpose: EVERY stage-change reason benefits (a review
 * move-back's required reason, a derived entry), no special-casing of any
 * one string. Read defensively off the untyped `payload`
 * (`EventView.payload` is deliberately unknown on the wire), display
 * labels via `STAGE_LABEL` when the value is a known stage, the raw wire
 * word otherwise. `null` when the event carries nothing renderable.
 */
const stageChangeAnnotation = (event: EventView): string | null => {
  if (event.type !== "bundle.stage_changed" || typeof event.payload !== "object" || event.payload === null) {
    return null;
  }
  const payload = event.payload as { readonly from?: unknown; readonly to?: unknown; readonly reason?: unknown };
  const stageWord = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? STAGE_LABEL[value as BundleStage] ?? value : null;
  const from = stageWord(payload.from);
  const to = stageWord(payload.to);
  const move = from !== null && to !== null ? `${from} → ${to}` : null;
  const reason = typeof payload.reason === "string" && payload.reason.length > 0 ? payload.reason : null;
  if (move === null && reason === null) {
    return null;
  }
  return [move, reason].filter((part): part is string => part !== null).join(" — ");
};

/** Turn the machine's precise-but-internal guard rejections into a sentence a director can read. Anything unrecognized passes through. */
const humanizeError = (message: string): string => {
  if (message.includes("requires an approved review")) {
    return "This needs an approved review before it can move to the next stage.";
  }
  if (message.includes("publish gate")) {
    return "This needs the publish gate cleared before it can ship.";
  }
  if (message.includes("require a non-empty reason")) {
    return "Add a reason before moving it back to an earlier stage.";
  }
  return message;
};

const shortHash = (hash: string): string => {
  const prefix = "sha256:";
  if (!hash.startsWith(prefix)) {
    return hash;
  }
  const hex = hash.slice(prefix.length);
  return `${prefix}${hex.slice(0, 10)}`;
};

/**
 * Fix 4 (Phase 20 Story 2 friction log F6): prefer the human `label`
 * recorded via "Record version"; fall back to a short hex fragment (7-8
 * chars, no `"sha256:"` prefix) only when no label exists. Mirrors core's
 * `versionLabel` (Versions.ts) so the CLI table and this viewer never
 * disagree on the fallback rule.
 */
const versionLabelFor = (version: VersionRecord | undefined, hash: string): string => {
  if (version !== undefined && version.label !== undefined && version.label.length > 0) {
    return version.label;
  }
  const prefix = "sha256:";
  const hex = hash.startsWith(prefix) ? hash.slice(prefix.length) : hash;
  return hex.length > 8 ? hex.slice(0, 8) : hex;
};

const DRIFT_LABEL: Record<Drift, string> = {
  "no-version": "No version recorded",
  "in-sync": "In sync",
  "design-changed": "Design changed",
  "output-hand-edited": "Output hand-edited",
  both: "Design changed + output hand-edited",
};

const DRIFT_EXPLANATION: Record<Drift, string> = {
  "no-version": "No version recorded yet.",
  "in-sync": "design.md and output/ match the latest recorded version.",
  "design-changed": "design.md has changed since the latest recorded version; output/ still matches.",
  "output-hand-edited": "output/ has been hand-edited since the latest recorded version; design.md still matches.",
  both: "Both design.md and output/ have changed since the latest recorded version.",
};

const DRIFT_BADGE_CLASS: Record<Drift, string> = {
  "in-sync": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  "no-version": "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  "design-changed": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "output-hand-edited": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  both: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const TABS: ReadonlyArray<{ readonly key: BundleTab; readonly label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "instructions", label: "Instructions" },
  { key: "models", label: "Models" },
  { key: "coverage", label: "Coverage" },
  { key: "research", label: "Research" },
  { key: "lineage", label: "Lineage" },
  { key: "files", label: "Files" },
];

/** IN Input / RE Reasoning / OUT Output / ADV Adversarial / CHN Chain (data-model.md §2.6). */
const RISK_FAMILY_ORDER = ["IN", "RE", "OUT", "ADV", "CHN"] as const;

const RISK_FAMILY_LABEL: Record<string, string> = {
  IN: "IN Input",
  RE: "RE Reasoning",
  OUT: "OUT Output",
  ADV: "ADV Adversarial",
  CHN: "CHN Chain",
};

/** The coverage pills (prototype `.cov-ok`/`.cov-mid`/`.cov-gap`): the authored word, colored -- moss / gold / rust in the app's own ramps. */
const COVERAGE_PILL_CLASS: Record<CoverageValue, string> = {
  covered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  gap: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  "n/a": "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

const COVERAGE_LABEL: Record<CoverageValue, string> = {
  covered: "covered",
  partial: "partial",
  gap: "gap",
  "n/a": "n/a",
};

/**
 * Where "back" goes per origin room (`?from=`, card-fidelity round 2): the
 * card belongs to no single room, so the back affordance names the room
 * the reader actually came from. Absent origin = Make, today's behavior.
 */
const ORIGIN_BACK: Record<CardOrigin, { readonly label: string; readonly href: string }> = {
  improve: { label: "← Improve", href: "/lab" },
  track: { label: "← Track", href: "/track" },
  ship: { label: "← Ship", href: "/ship" },
  receive: { label: "← Receive", href: "/receive" },
};

export const SkillCard: FC<{
  slug: string;
  tab: BundleTab;
  runId: string | undefined;
  file: string | undefined;
  /** `?fixture=` -- the Models tab's auto-expanded test body (Coverage's cross-link target). */
  fixture: string | undefined;
  /** `?from=` -- the origin room this card displays under (back link + nav highlight); absent = Make. */
  from: CardOrigin | undefined;
}> = ({ slug, tab, runId, file, fixture, from }) => {
  const { detail, loading, error, refetch } = useBundleDetail(slug);
  const { navigate } = useRouter();
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [reviseNotes, setReviseNotes] = useState("");
  const [reviewQuestion, setReviewQuestion] = useState("");
  const [backTarget, setBackTarget] = useState("");
  const [backReason, setBackReason] = useState("");
  const [gateBasis, setGateBasis] = useState("");

  // Post a sequence of events in order, stopping at the first failure -- the
  // same collapse `PublishSection` uses for gate+advance, generalized so one
  // guided click can e.g. approve-then-advance. A partial failure leaves a
  // legal intermediate state the card re-renders the next step from.
  const submitMany = (events: ReadonlyArray<PostEventInput>): void => {
    setPending(true);
    setActionError(undefined);
    void (async () => {
      for (const event of events) {
        const result = await postEvent(event);
        if (!result.ok) {
          setActionError(result.error);
          return;
        }
      }
      setActionError(undefined);
      refetch();
    })()
      .catch((cause: Error) => setActionError(cause.message))
      .finally(() => setPending(false));
  };

  // A single event is just the one-element case of `submitMany`.
  const submit = (type: string, payload: Record<string, unknown>): void => submitMany([{ type, payload }]);

  // Derived ONCE per render, next to `detail` (simplify pass): the header's
  // glance strip and Overview's Facts table both read the same proven-on
  // list, so it is computed here and passed down rather than re-derived in
  // each child on every action-form keystroke.
  const proven = detail === undefined ? [] : provenOnProviders(detail.measurements, detail.versions[0]?.hash);

  const back = from !== undefined ? ORIGIN_BACK[from] : { label: "← Make", href: "/" };

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-start justify-between">
        <Link
          href={back.href}
          className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          {back.label}
        </Link>
      </div>

      {loading && detail === undefined && <p className="text-sm text-neutral-500">Loading...</p>}
      {error !== undefined && (
        <p className="text-sm text-red-700 dark:text-red-300">Could not load skill: {error.message}</p>
      )}

      {detail !== undefined && (
        /* The card OBJECT (prototype `.card`): strong ink border, amber
           accent strip, hard offset shadow (`.card-shadow-lg`, the skin's
           card-object motif in global.css), footer stamp -- a physical
           index card, visually distinct from the app's flat panels. All
           surfaces use theme tokens (`surface`, `canvas`, `border`, `ink`,
           `paper-dark`) so dark mode flips with the skin. */
        <article className="card-shadow-lg overflow-hidden rounded-xl border-2 border-ink bg-surface">
          <div className="h-2 bg-amber-500" aria-hidden="true" />

          <CardHeader detail={detail} proven={proven} />

          {/* File-folder tabs over the bordered "page" (prototype `.tabs`/`.page`). */}
          <div className="flex flex-wrap gap-0.5 px-4 pt-4 sm:px-6">
            {TABS.map((candidate) => (
              <Link
                key={candidate.key}
                href={bundleHref(slug, candidate.key, from)}
                className={
                  tab === candidate.key
                    ? "relative z-10 -mb-px rounded-t-lg border border-b-0 border-neutral-900/50 bg-surface px-3 pb-1.5 pt-2 font-mono text-[11px] uppercase text-neutral-900 dark:border-neutral-100/50 dark:text-neutral-100"
                    : "rounded-t-lg border border-b-0 border-border bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }
              >
                {candidate.label}
              </Link>
            ))}
          </div>

          <div className="mx-4 mb-5 flex flex-col gap-4 rounded-b-xl rounded-tr-xl border border-neutral-900/40 bg-surface p-4 sm:mx-6 sm:p-6 dark:border-neutral-100/40">
            {tab === "overview" && (
              <OverviewTab
                detail={detail}
                proven={proven}
                slug={slug}
                from={from}
                pending={pending}
                actionError={actionError}
                reviseNotes={reviseNotes}
                setReviseNotes={setReviseNotes}
                reviewQuestion={reviewQuestion}
                setReviewQuestion={setReviewQuestion}
                backTarget={backTarget}
                setBackTarget={setBackTarget}
                backReason={backReason}
                setBackReason={setBackReason}
                gateBasis={gateBasis}
                setGateBasis={setGateBasis}
                submit={submit}
                submitMany={submitMany}
                onChanged={refetch}
              />
            )}
            {tab === "instructions" && (
              <InstructionsTab
                slug={slug}
                from={from}
                instructionsPath={detail.instructionsPath}
                latestVersion={detail.versions[0]}
                drift={detail.bundle.drift}
              />
            )}
            {tab === "models" && (
              <ModelsTab
                slug={slug}
                fixtures={detail.fixtures}
                runs={detail.runs}
                measurements={detail.measurements}
                versions={detail.versions}
                runId={runId}
                fixtureParam={fixture}
                onOpenRun={(id) => navigate(bundleRunHref(slug, id, from))}
                onCloseRun={() => navigate(bundleHref(slug, "models", from))}
                onChanged={refetch}
              />
            )}
            {tab === "coverage" && (
              <CoverageTab slug={slug} from={from} riskCoverage={detail.riskCoverage} warnings={detail.warnings} />
            )}
            {tab === "research" && <DossierSection dossier={detail.dossier} />}
            {tab === "lineage" && (
              <LineageTab
                slug={slug}
                from={from}
                lineage={detail.lineage}
                drift={detail.bundle.drift}
                versions={detail.versions}
                onRecorded={refetch}
              />
            )}
            {tab === "files" && <FilesTab slug={slug} files={detail.files} initialFile={file} />}
          </div>

          {/* "Next" lives OUTSIDE the tabbed page, always visible (prototype):
              derivable-today gaps only, whatever tab is open. */}
          <NextChips detail={detail} />

          <footer className="flex justify-between gap-3 border-t border-neutral-900/15 bg-canvas/60 px-4 py-2.5 font-mono text-[10px] text-neutral-500 sm:px-6 dark:border-neutral-100/15 dark:text-neutral-400">
            <span>SKILLMAKER STUDIO</span>
          </footer>
        </article>
      )}
    </div>
  );
};

/** One cell of the glance strip: small label above, big mono value, small detail below (prototype `.kl`/`.kv`/`.kvs`). */
const GlanceCell: FC<{ label: string; value: string; sub: string; title?: string }> = ({ label, value, sub, title }) => (
  <div className="bg-surface px-3.5 py-2.5" title={title}>
    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">{label}</p>
    <p className="mt-0.5 font-mono text-lg leading-snug text-neutral-900 dark:text-neutral-100">{value}</p>
    <p className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">{sub}</p>
  </div>
);

/**
 * The always-visible header (prototype `.hd`): eyebrow · big mono slug ·
 * one-liner · tag pills on the left; the badge stack (stage · short
 * version, drift, Unverified, Retired) on the right. Below it the 3-cell
 * GLANCE STRIP -- Proven on / Coverage / Version -- the readability core.
 * Every empty state is an honest gap, dossier-style.
 */
const CardHeader: FC<{
  detail: NonNullable<ReturnType<typeof useBundleDetail>["detail"]>;
  /** Proven-on provider ids, derived once in `SkillCard` and shared with Overview's Facts table. */
  proven: ReadonlyArray<string>;
}> = ({ detail, proven }) => {
  const { bundle } = detail;
  const latestVersion = detail.versions[0];
  const tally = coverageTally(detail.riskCoverage);

  return (
    <header className="px-4 pt-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-600 dark:text-amber-400">
            skill card
          </p>
          <h3 className="break-words font-mono text-xl leading-tight text-neutral-900 sm:text-2xl dark:text-neutral-100">
            {bundle.slug}
          </h3>
          {bundle.name.length > 0 && bundle.name !== bundle.slug && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">{bundle.name}</p>
          )}
          {bundle.oneLiner.length > 0 && (
            <p className="mt-0.5 text-sm text-neutral-600 dark:text-neutral-300">{bundle.oneLiner}</p>
          )}
          {bundle.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {bundle.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border bg-canvas px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <Badge
            tone={STAGE_BADGE_CLASS[bundle.stage]}
            title={latestVersion !== undefined ? latestVersion.hash : "No version recorded yet."}
          >
            {STAGE_LABEL[bundle.stage]}
            {" · "}
            {latestVersion === undefined ? "no version" : versionLabelFor(latestVersion, latestVersion.hash)}
          </Badge>
          <Badge tone={DRIFT_BADGE_CLASS[bundle.drift]} title={DRIFT_EXPLANATION[bundle.drift]}>
            drift: {DRIFT_LABEL[bundle.drift]}
          </Badge>
          {detail.unverified && (
            <Badge tone={UNVERIFIED_BADGE_CLASS} title="Arrived from outside; we have not yet measured it.">
              Unverified
            </Badge>
          )}
          {bundle.archived && <Badge tone={RETIRED_BADGE_CLASS}>Retired</Badge>}
        </div>
      </div>

      {/* The glance strip (prototype `.glance`): a 3-cell bordered grid. */}
      <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <GlanceCell
          label="Proven on"
          value={proven.length === 0 ? "none yet" : `${proven.length} provider(s)`}
          sub={proven.length === 0 ? "no passing measurement at this version" : proven.join(", ")}
          title="Providers with at least one passing measurement at the latest recorded version -- exact recorded ids."
        />
        <GlanceCell
          label="Coverage"
          value={tally.total === 0 ? "none authored" : `${tally.covered}/${tally.total} covered`}
          sub={tally.total === 0 ? "no risk-map.md yet" : `${tally.partial} partial · ${tally.gap} gap`}
          title="The risk map's authored judgments -- coverage is never a pass rate."
        />
        <GlanceCell
          label="Version"
          value={detail.versions.length === 0 ? "none recorded" : `${detail.versions.length} recorded`}
          sub={
            latestVersion === undefined
              ? "No version recorded yet"
              : `latest ${versionLabelFor(latestVersion, latestVersion.hash)} · ${formatDay(latestVersion.recordedAt)}`
          }
          title={latestVersion?.hash}
        />
      </div>
    </header>
  );
};

interface OverviewTabProps {
  readonly detail: NonNullable<ReturnType<typeof useBundleDetail>["detail"]>;
  /** Proven-on provider ids, derived once in `SkillCard` (shared with the header's glance strip). */
  readonly proven: ReadonlyArray<string>;
  readonly slug: string;
  /** The card's origin room (`?from=`), preserved on every internal link. */
  readonly from: CardOrigin | undefined;
  readonly pending: boolean;
  readonly actionError: string | undefined;
  readonly reviseNotes: string;
  readonly setReviseNotes: (value: string) => void;
  readonly reviewQuestion: string;
  readonly setReviewQuestion: (value: string) => void;
  readonly backTarget: string;
  readonly setBackTarget: (value: string) => void;
  readonly backReason: string;
  readonly setBackReason: (value: string) => void;
  readonly gateBasis: string;
  readonly setGateBasis: (value: string) => void;
  readonly submit: (type: string, payload: Record<string, unknown>) => void;
  readonly submitMany: (events: ReadonlyArray<PostEventInput>) => void;
  readonly onChanged: () => void;
}

/**
 * `dossier.md`'s sections, rendered as recorded content or an honest gap
 * (issue #94, `Mechanism - Receiving Dock.md`'s "unanswered fields display
 * as honest gaps ... never block anything") -- the card's Research tab
 * (issue #109: the dossier IS the card's authored core). Handoff CLAIMS
 * (issue #108) render per context when present; absent = unclaimed =
 * honest gap, no placeholder row.
 */
const DossierSection: FC<{ dossier: DossierRecord }> = ({ dossier }) => {
  const fields: ReadonlyArray<readonly [string, string | undefined]> = [
    ["Job", dossier.job],
    ["Out-of-scope", dossier.outOfScope],
    ["Basis", dossier.basis],
    ["Evidence", dossier.evidence],
    ["Fit criterion", dossier.fitCriterion],
  ];
  return (
    <section className="flex flex-col gap-2">
      <h4 className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
        Context of use
      </h4>
      <dl className="flex flex-col text-[13px]">
        {fields.map(([label, value]) => (
          <div key={label} className="flex gap-3 border-t border-border py-1.5 first:border-t-0">
            <dt className="w-28 shrink-0 text-neutral-500 dark:text-neutral-400">{label}</dt>
            <dd className="text-neutral-700 dark:text-neutral-300">{value ?? <Unrecorded />}</dd>
          </div>
        ))}
        <div className="flex gap-3 border-t border-border py-1.5">
          <dt className="w-28 shrink-0 text-neutral-500 dark:text-neutral-400">Contexts</dt>
          <dd className="text-neutral-700 dark:text-neutral-300">
            {dossier.contexts.length === 0 ? (
              <Unrecorded word="none named" />
            ) : (
              <ul className="flex flex-col gap-1">
                {dossier.contexts.map((context) => {
                  // Handoff CLAIMS (issue #108): rendered only when present
                  // (absent = unclaimed = honest gap, no placeholder row) --
                  // free text, never a link, never resolved to a bundle.
                  const claims: ReadonlyArray<readonly [string, string | undefined]> = [
                    ["Upstream", context.upstream],
                    ["Downstream", context.downstream],
                    ["Hands", context.hands],
                  ];
                  return (
                    <li key={context.name}>
                      <span className="font-medium text-neutral-800 dark:text-neutral-100">{context.name}</span>
                      {context.body.length > 0 ? `: ${context.body}` : ""}
                      {claims
                        .filter((claim): claim is readonly [string, string] => claim[1] !== undefined)
                        .map(([label, value]) => (
                          <div key={label} className="text-neutral-500 dark:text-neutral-400">
                            {label}: <span className="text-neutral-700 dark:text-neutral-300">{value}</span>
                          </div>
                        ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
};

/**
 * "Next, from what we already know" (issue #109; prototype `.chips`):
 * derivable-today gaps only -- uncovered risks, fixtures below the smoke
 * threshold, unmeasured providers. No speculative plays, no scoring, no
 * heat. Lives OUTSIDE the tabbed page, always visible whatever tab is
 * open: a dashed "derivable" chip + bold title + one-line detail per row.
 * An empty list is a quiet, honest "nothing derivable to suggest," not a
 * congratulation.
 */
const NextChips: FC<{ detail: NonNullable<ReturnType<typeof useBundleDetail>["detail"]> }> = ({ detail }) => {
  const { state } = useWorkspace();
  const chips = nextChips({
    riskCoverage: detail.riskCoverage,
    fixtures: detail.fixtures,
    measurements: detail.measurements,
    latestHash: detail.versions[0]?.hash,
    providers: state?.config.providers ?? [],
  });
  if (chips.length === 0) {
    return null;
  }
  return (
    <section className="px-4 pb-3 sm:px-6">
      <h4 className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
        Next, from what we already know
      </h4>
      <ul className="flex flex-col">
        {chips.map((chip) => (
          <li key={chip.key} className="border-b border-border py-2 last:border-b-0">
            <span className="mr-2 rounded border border-dashed border-amber-600 px-1.5 py-0.5 align-middle font-mono text-[9px] uppercase tracking-wider text-amber-600 dark:border-amber-400 dark:text-amber-400">
              derivable
            </span>
            <b className="text-[13px] text-neutral-900 dark:text-neutral-100">{chip.title}</b>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{chip.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
};

/** The one italic warning-toned honest-gap rendering (prototype `.unrec`) -- shared by Facts, Pipeline, and the Research table. */
const Unrecorded: FC<{ word?: string }> = ({ word = "unrecorded" }) => (
  <span className="italic text-red-600 dark:text-red-400">{word}</span>
);

/** The one law-line footnote (prototype `.gaprow`): every per-tab honest-read note shares this style so spacing never drifts between tabs. */
const Footnote: FC<{ children: ReactNode }> = ({ children }) => (
  <p className="text-xs text-neutral-500 dark:text-neutral-400">{children}</p>
);

/**
 * Overview's two-column core (prototype `.two`): the "Facts" mini-table
 * (Runtime / Stage / Fixtures / Created / Drift) and the "Pipeline
 * (neighborhood)" block -- the dossier's handoff CLAIMS per context when
 * present (issue #108: free text, never a link, never resolved to a
 * bundle), else the honest italic gap instead of an inferred graph.
 * "Created" is the first custody event's day (the journal's first sighting
 * -- the payload carries no created-at field), an honest gap when the
 * journal is empty.
 */
const FactsAndPipeline: FC<{
  detail: NonNullable<ReturnType<typeof useBundleDetail>["detail"]>;
  /** Proven-on provider ids, derived once in `SkillCard` (shared with the header's glance strip). */
  proven: ReadonlyArray<string>;
}> = ({ detail, proven }) => {
  const { bundle } = detail;
  const firstCustody = detail.lineage.custody[0];
  const contextsWithClaims = detail.dossier.contexts.filter(
    (context) => context.upstream !== undefined || context.downstream !== undefined || context.hands !== undefined,
  );
  const facts: ReadonlyArray<readonly [string, ReactNode]> = [
    ["Runtime", proven.length > 0 ? proven.join(", ") : <Unrecorded word="none proven yet" />],
    ["Stage", STAGE_LABEL[bundle.stage]],
    ["Fixtures", String(detail.fixtures.length)],
    ["Created", firstCustody !== undefined ? formatDay(firstCustody.at) : <Unrecorded />],
    ["Drift", DRIFT_LABEL[bundle.drift]],
  ];

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      <div>
        <h4 className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
          Facts
        </h4>
        <table className="w-full text-[13px]">
          <tbody>
            {facts.map(([label, value]) => (
              <tr key={label} className="border-t border-border first:border-t-0">
                <td className="py-1.5 pr-3 text-neutral-500 dark:text-neutral-400">{label}</td>
                <td className="py-1.5 font-mono text-neutral-800 dark:text-neutral-200">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h4 className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
          Pipeline
        </h4>
        {contextsWithClaims.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            No upstream or downstream skills recorded.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px]">
            {contextsWithClaims.map((context) => {
              const claims: ReadonlyArray<readonly [string, string | undefined]> = [
                ["Upstream", context.upstream],
                ["Downstream", context.downstream],
                ["Hands", context.hands],
              ];
              return (
                <li key={context.name}>
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">{context.name}</span>
                  {claims
                    .filter((claim): claim is readonly [string, string] => claim[1] !== undefined)
                    .map(([label, value]) => (
                      <div key={label} className="text-neutral-500 dark:text-neutral-400">
                        {label}: <span className="text-neutral-700 dark:text-neutral-300">{value}</span>
                      </div>
                    ))}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

/**
 * The most recent review verdict on the current stage's work (friction #13,
 * derived by `runtime/reviewPanel.ts`): the decision word, the timestamp,
 * the submitted notes verbatim, and the next step said out loud -- so a
 * send-back's notes stay visible on the card instead of vanishing into the
 * journal the moment the button is clicked.
 */
const ReviewOutcomePanel: FC<{ outcome: ReviewOutcome }> = ({ outcome }) => (
  <section className="flex flex-col gap-1.5 rounded-md border border-border bg-canvas p-3">
    <div className="flex flex-wrap items-baseline gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Latest review — {outcome.headline}
      </h4>
      <span className="text-[11px] text-neutral-400">{formatTimestamp(outcome.at)}</span>
    </div>
    {outcome.notes !== undefined && (
      <p className="whitespace-pre-wrap border-l-2 border-amber-500 pl-2 text-xs text-neutral-700 dark:text-neutral-200">
        {outcome.notes}
      </p>
    )}
    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">{outcome.nextStep}</p>
  </section>
);

const OverviewTab: FC<OverviewTabProps> = ({
  detail,
  proven,
  slug,
  from,
  pending,
  actionError,
  reviseNotes,
  setReviseNotes,
  reviewQuestion,
  setReviewQuestion,
  backTarget,
  setBackTarget,
  backReason,
  setBackReason,
  gateBasis,
  setGateBasis,
  submit,
  submitMany,
  onChanged,
}) => {
  const { bundle, guardStatus } = detail;
  const stage = bundle.stage;
  const action = nextAction(stage, bundle.substate, guardStatus);
  // The unresolved review request, labeled by the state that REQUESTED it
  // (friction #18) -- carries the question and the exact files the station
  // changed (`artifacts`), so the reviewer can open what they're being asked
  // to approve. `undefined` once resolved (or never requested), so stale
  // questions stop soliciting review of work that isn't pending.
  const pendingRequest = pendingReview(detail.events, stage);
  const question = pendingRequest?.question;
  const reviewArtifacts = pendingRequest?.artifacts ?? [];
  // The most recent review verdict on this stage's work (friction #13):
  // rendered as a panel so submitted notes never vanish after the click.
  const reviewOutcome = latestReviewOutcome(detail.events, stage);
  const forwardReady = guardStatus.approvedForForward && (stage !== "evaluating" || guardStatus.gateApproved);
  const earlier = earlierStages(stage);
  const [stationPending, setStationPending] = useState(false);
  const [stationError, setStationError] = useState<string | undefined>(undefined);

  const runCurrentStageStation = (): void => {
    if (detail.station === null) {
      return;
    }
    setStationPending(true);
    setStationError(undefined);
    triggerStationRun(slug, detail.station.state, undefined)
      .then((result) => {
        if (!result.ok) {
          setStationError(result.error);
          return;
        }
        // The station run proceeds server-side; the SSE journal stream
        // refreshes the card as station.started/review.requested land. One
        // eager refetch so the change shows up promptly, same as FixtureRow.
        onChanged();
      })
      .catch((cause: Error) => setStationError(cause.message))
      .finally(() => setStationPending(false));
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-neutral-800 dark:text-neutral-100">
          {statusLineFor(stage, bundle.substate, forwardReady)}
        </p>
        <details className="text-[11px] text-neutral-400">
          <summary className="cursor-pointer select-none">Details</summary>
          <p className="mt-1 font-mono">
            stage {stage} · substate {bundle.substate} · approved-for-forward{" "}
            {String(guardStatus.approvedForForward)} · gate-approved {String(guardStatus.gateApproved)}
          </p>
        </details>
      </div>

      <FactsAndPipeline detail={detail} proven={proven} />

      {/* Every action affordance the old panel had, grouped under ONE
          labeled area (card-fidelity round) so the workflow controls stop
          dominating the read -- readability first, capabilities intact. */}
      <section className="flex flex-col gap-3 rounded-md border border-border p-3">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
          Actions
        </h4>

        {actionError !== undefined && (
          <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
            {humanizeError(actionError)}
          </p>
        )}

        {/* The most recent review verdict on this stage's work (friction
            #13): decision + when + the submitted notes + what happens next.
            Without this, "Send back with notes" left the card looking
            identical to pre-review -- machinery flawless, interface silent. */}
        {reviewOutcome !== undefined && <ReviewOutcomePanel outcome={reviewOutcome} />}

        {action.kind === "terminal" && (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            Published — this skill has shipped.
          </p>
        )}

        {action.kind === "gate" && (
          <>
            {/* Publishing is two conscious steps: approve the evaluation (no
                advance -- the gate does that), then clear the publish gate. */}
            {!guardStatus.approvedForForward && (
              <section className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                {/* Labeled by the work under review (friction #18): the
                    requesting event's state names the heading, never the
                    bundle's current stage -- and with NO pending review the
                    gate stops soliciting approval of work that doesn't
                    exist and says what the button really records. */}
                <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  {bundle.substate === "awaiting-review"
                    ? (pendingRequest?.title ?? "Review the submitted work")
                    : `Sign off the ${STAGE_LABEL[stage]} stage yourself`}
                </h4>
                {pendingRequest?.staleNote !== undefined && (
                  <p className="text-[11px] text-neutral-600 dark:text-neutral-300">{pendingRequest.staleNote}</p>
                )}
                <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
                  {bundle.substate === "awaiting-review"
                    ? "Then clear the publish gate below to ship."
                    : `No review is pending — nothing has been submitted for review here. Approving records your own sign-off of the ${STAGE_LABEL[stage]} stage so the publish gate below can open.`}
                </p>
                {question !== undefined && question.length > 0 && (
                  <p className="text-xs text-neutral-700 dark:text-neutral-200">{question}</p>
                )}
                {reviewArtifacts.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {reviewArtifacts.map((path) => (
                      <li key={path}>
                        <Link
                          href={bundleFileHref(slug, path, from)}
                          className="font-mono text-xs text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
                        >
                          {path}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {bundle.substate === "awaiting-review" && (
                  <textarea
                    value={reviseNotes}
                    onChange={(event) => setReviseNotes(event.target.value)}
                    placeholder="Notes for the author (optional on approve, required to send back)"
                    className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    bundle.substate === "awaiting-review"
                      ? submit("review.resolved", {
                          bundle: slug,
                          state: stage,
                          decision: "approve",
                          // Approve-with-notes (friction #15): commentary rides
                          // along for the record; `latestReviseNotes` only ever
                          // injects `revise` notes into station prompts.
                          ...(reviseNotes.trim().length > 0 ? { notes: reviseNotes.trim() } : {}),
                        })
                      : submitMany([
                          { type: "review.requested", payload: { bundle: slug, state: stage } },
                          { type: "review.resolved", payload: { bundle: slug, state: stage, decision: "approve" } },
                        ])
                  }
                  className="self-start rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  {bundle.substate === "awaiting-review" ? "Approve" : "Record my sign-off"}
                </button>
                {bundle.substate === "awaiting-review" && (
                  <button
                    type="button"
                    disabled={pending || reviseNotes.trim().length === 0}
                    onClick={() =>
                      submit("review.resolved", { bundle: slug, state: stage, decision: "revise", notes: reviseNotes.trim() })
                    }
                    className="self-start rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
                  >
                    Send back with notes
                  </button>
                )}
              </section>
            )}
            <PublishSection
              slug={slug}
              approvedForForward={guardStatus.approvedForForward}
              gateApproved={guardStatus.gateApproved}
              gateBasis={gateBasis}
              setGateBasis={setGateBasis}
              onChanged={onChanged}
            />
          </>
        )}

        {action.kind === "review" && (
          <section className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
            {/* Named for the work under review (friction #18), not the
                bundle's current stage. */}
            <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              {pendingRequest?.title ?? "Review the submitted work"}
            </h4>
            {pendingRequest?.staleNote !== undefined && (
              <p className="text-[11px] text-neutral-600 dark:text-neutral-300">{pendingRequest.staleNote}</p>
            )}
            {question !== undefined && question.length > 0 && (
              <p className="text-xs text-neutral-700 dark:text-neutral-200">{question}</p>
            )}
            {reviewArtifacts.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {reviewArtifacts.map((path) => (
                  <li key={path}>
                    <Link
                      href={bundleFileHref(slug, path, from)}
                      className="font-mono text-xs text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
                    >
                      {path}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              value={reviseNotes}
              onChange={(event) => setReviseNotes(event.target.value)}
              placeholder="Notes for the author (optional on approve, required to send back)"
              className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                submitMany([
                  {
                    type: "review.resolved",
                    payload: {
                      bundle: slug,
                      state: stage,
                      decision: "approve",
                      // Approve-with-notes (friction #15): "LGTM with nits"
                      // rides along for the record; only `revise` notes are
                      // ever fed to the agent (core's `latestReviseNotes`).
                      ...(reviseNotes.trim().length > 0 ? { notes: reviseNotes.trim() } : {}),
                    },
                  },
                  { type: "bundle.stage_changed", payload: { bundle: slug, from: stage, to: action.nextStage } },
                ])
              }
              className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Approve &amp; move to {STAGE_LABEL[action.nextStage]} ▸
            </button>
            <button
              type="button"
              disabled={pending || reviseNotes.trim().length === 0}
              onClick={() =>
                submit("review.resolved", { bundle: slug, state: stage, decision: "revise", notes: reviseNotes.trim() })
              }
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
            >
              Send back with notes
            </button>
          </section>
        )}

        {action.kind === "advance" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("bundle.stage_changed", { bundle: slug, from: stage, to: action.nextStage })}
            className="self-start rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            Move to {STAGE_LABEL[action.nextStage]} ▸
          </button>
        )}

        {action.kind === "approve-advance" && (
          <section className="flex flex-col gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                // Collapse the solo review pair: request -> approve -> advance in
                // one click. review.resolved is only accepted while awaiting-review
                // (Server.ts), so the request must lead; the journal still records
                // the full pair.
                submitMany([
                  { type: "review.requested", payload: { bundle: slug, state: stage } },
                  { type: "review.resolved", payload: { bundle: slug, state: stage, decision: "approve" } },
                  { type: "bundle.stage_changed", payload: { bundle: slug, from: stage, to: action.nextStage } },
                ])
              }
              className="self-start rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Approve &amp; move to {STAGE_LABEL[action.nextStage]} ▸
            </button>

            <details className="rounded-md border border-neutral-200 p-2 text-[11px] dark:border-neutral-800">
              <summary className="cursor-pointer select-none text-neutral-500">Other ways forward</summary>
              <div className="mt-2 flex flex-col gap-3">
                {detail.station !== null && (
                  <div className="flex flex-col gap-1">
                    <p className="text-neutral-600 dark:text-neutral-300">
                      Have an agent do the {STAGE_LABEL[stage]} stage's work (skill{" "}
                      <span className="font-mono">{detail.station.skill}</span>) — it requests your review when done.
                    </p>
                    {stationError !== undefined && (
                      <p className="rounded-md bg-red-100 px-2 py-1 text-red-800 dark:bg-red-950 dark:text-red-300">
                        {stationError}
                      </p>
                    )}
                    <button
                      type="button"
                      disabled={stationPending}
                      onClick={runCurrentStageStation}
                      className="self-start rounded-md bg-neutral-900 px-2 py-1 font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      Run station ▸
                    </button>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <p className="text-neutral-600 dark:text-neutral-300">Or hand it to someone else to review first:</p>
                  <input
                    value={reviewQuestion}
                    onChange={(event) => setReviewQuestion(event.target.value)}
                    placeholder="Question for the reviewer (optional)"
                    className="w-full rounded-md border border-neutral-300 p-2 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      submit("review.requested", {
                        bundle: slug,
                        state: stage,
                        ...(reviewQuestion.trim().length > 0 ? { question: reviewQuestion.trim() } : {}),
                      })
                    }
                    className="self-start rounded-md border border-neutral-300 px-2 py-1 font-medium disabled:opacity-50 dark:border-neutral-700"
                  >
                    Request review
                  </button>
                </div>
              </div>
            </details>
          </section>
        )}

        {stage === "published" && <PublishToTargetsSection slug={slug} />}

        {earlier.length > 0 && (
          <details className="text-[11px] text-neutral-400">
            <summary className="cursor-pointer select-none">Move to an earlier stage</summary>
            <div className="mt-2 flex flex-col gap-2">
              <select
                value={backTarget}
                onChange={(event) => setBackTarget(event.target.value)}
                className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              >
                <option value="">Select an earlier stage</option>
                {earlier.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {STAGE_LABEL[candidate]}
                  </option>
                ))}
              </select>
              <input
                value={backReason}
                onChange={(event) => setBackReason(event.target.value)}
                placeholder="Reason (required)"
                className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button
                type="button"
                disabled={pending || backTarget.length === 0 || backReason.trim().length === 0}
                onClick={() =>
                  submit("bundle.stage_changed", { bundle: slug, from: stage, to: backTarget, reason: backReason.trim() })
                }
                className="self-start rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium disabled:opacity-50 dark:border-neutral-700"
              >
                Move back
              </button>
            </div>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Recent events</h4>
        <ul className="flex flex-col gap-1">
          {detail.events.map((event: EventView) => {
            const annotation = stageChangeAnnotation(event);
            return (
              <li key={event.id} className="text-[11px] text-neutral-600 dark:text-neutral-300">
                <span className="font-mono">{event.type}</span>
                {annotation !== null && <span className="text-neutral-500 dark:text-neutral-400"> {annotation}</span>}{" "}
                <span className="text-neutral-400">{formatTimestamp(event.at)}</span>
              </li>
            );
          })}
          {detail.events.length === 0 && <li className="text-[11px] text-neutral-400">No events yet.</li>}
        </ul>
      </section>
    </>
  );
};

/**
 * The publish action (director ruling, ui-pass-spec.md "Director rulings"
 * #1): a distinct guided flow, not the generic "advance" -- one basis input
 * drives ONE click that submits `bundle.gate_decided` (decision: approved)
 * followed by `bundle.stage_changed` to "published". Replaces the generic
 * advance button for exactly the evaluating -> published transition; every
 * other transition still uses the plain advance button in `OverviewTab`.
 */
const PublishSection: FC<{
  slug: string;
  approvedForForward: boolean;
  gateApproved: boolean;
  gateBasis: string;
  setGateBasis: (value: string) => void;
  onChanged: () => void;
}> = ({ slug, approvedForForward, gateApproved, gateBasis, setGateBasis, onChanged }) => {
  const [pending, setPending] = useState(false);
  const [publishError, setPublishError] = useState<string | undefined>(undefined);

  if (!approvedForForward) {
    return (
      <section className="flex flex-col gap-1 rounded-md border border-dashed border-neutral-300 p-3 text-[11px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        Publishing requires an approved review of the {STAGE_LABEL.evaluating} stage first.
      </section>
    );
  }

  // The gate was already approved (e.g. a prior attempt got this far but the
  // stage-change step failed/was interrupted) -- only the second step
  // remains, so only offer that, not a redundant basis input.
  if (gateApproved) {
    return (
      <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Publish</h4>
        <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
          The publish gate is already approved. Finish moving this skill to Published.
        </p>
        {publishError !== undefined && (
          <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
            {publishError}
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true);
            setPublishError(undefined);
            postEvent({ type: "bundle.stage_changed", payload: { bundle: slug, from: "evaluating", to: "published" } })
              .then((result) => {
                if (!result.ok) {
                  setPublishError(result.error);
                  return;
                }
                onChanged();
              })
              .catch((cause: Error) => setPublishError(cause.message))
              .finally(() => setPending(false));
          }}
          className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Publish ▸
        </button>
      </section>
    );
  }

  const publish = (): void => {
    if (gateBasis.trim().length === 0) {
      return;
    }
    setPending(true);
    setPublishError(undefined);
    postEvent({
      type: "bundle.gate_decided",
      payload: { bundle: slug, gate: "publish", decision: "approved", basis: gateBasis.trim() },
    })
      .then((gateResult) => {
        if (!gateResult.ok) {
          setPublishError(gateResult.error);
          return;
        }
        return postEvent({
          type: "bundle.stage_changed",
          payload: { bundle: slug, from: "evaluating", to: "published" },
        }).then((stageResult) => {
          if (!stageResult.ok) {
            setPublishError(stageResult.error);
            return;
          }
          setGateBasis("");
          onChanged();
        });
      })
      .catch((cause: Error) => setPublishError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Publish</h4>
      <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
        Record the publish-gate decision basis and move this skill to Published in one step.
      </p>
      <input
        value={gateBasis}
        onChange={(event) => setGateBasis(event.target.value)}
        placeholder="Basis (evidence summary, required)"
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      />
      {publishError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {publishError}
        </p>
      )}
      <button
        type="button"
        disabled={pending || gateBasis.trim().length === 0}
        onClick={publish}
        className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        Approve gate &amp; publish ▸
      </button>
    </section>
  );
};

/**
 * Phase 11B's post-publish step: once a bundle is `"published"`, offers a
 * "Publish to targets" button that runs core `publishBundle` server-side
 * (`POST /api/bundles/:slug/publish`, the same contract `skillmaker publish`
 * runs) against every `publishTargets` entry in `skillmaker.config.json`.
 * Renders nothing (an honest empty state -- no targets configured is a
 * normal, unremarkable workspace state) when `publishTargets` is empty.
 */
const PublishToTargetsSection: FC<{ slug: string }> = ({ slug }) => {
  const { state } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<ReadonlyArray<PublishTargetResult> | undefined>(undefined);

  const targets = state?.config.publishTargets ?? [];
  if (targets.length === 0) {
    return null;
  }

  const run = (): void => {
    setPending(true);
    setError(undefined);
    publishBundle(slug, undefined)
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setResults(result.response.results);
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Publish to targets</h4>
      <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
        {targets.length} target{targets.length === 1 ? "" : "s"} configured: {targets.map((target) => target.id).join(", ")}
      </p>
      {error !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className="w-fit rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        Publish to targets ▸
      </button>
      {results !== undefined && (
        <ul className="flex flex-col gap-1">
          {results.map((entry) => (
            <li key={entry.target} className="text-[11px] text-neutral-600 dark:text-neutral-300">
              <span className="font-mono">{entry.target}</span> ({entry.kind}):{" "}
              {entry.status === "already_published" ? "already published" : "published"}
              {entry.url !== undefined ? ` -> ${entry.url}` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/**
 * The Instructions tab (card-fidelity round, problem 3: "I can't find the
 * actual skill in the skill card"): the shipped SKILL.md rendered
 * read-only -- the card's payload, one tab after Overview. The SERVER owns
 * which file that is (`instructionsPath` on the detail payload, derived
 * from the bundle's resolved layout: `output/SKILL.md` for output-dir
 * bundles, `SKILL.md` for in-place ones; `null` when it doesn't exist) --
 * the viewer never re-derives `BundleLayout` by probing the files list.
 * Content comes through the same `GET /api/bundles/:slug/file` endpoint as
 * the Files tab, via the shared `useBundleFileContent` hook. The header
 * line binds the text honestly: the endpoint serves the LIVE file, so the
 * recorded-version label plus the drift state is exactly the honest claim
 * about what you are reading. Empty/missing file: an honest gap line,
 * never a spinner that lies.
 */
const InstructionsTab: FC<{
  slug: string;
  from: CardOrigin | undefined;
  instructionsPath: string | null;
  latestVersion: VersionRecord | undefined;
  drift: Drift;
}> = ({ slug, from, instructionsPath, latestVersion, drift }) => {
  const path = instructionsPath ?? undefined;
  const { content, loading, error: fileError } = useBundleFileContent(slug, path);

  if (path === undefined) {
    return (
      <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
        <Unrecorded word="No SKILL.md yet." /> The Draft stage writes <span className="font-mono">output/SKILL.md</span>.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          The shipped instructions at{" "}
          <span className="font-mono text-neutral-700 dark:text-neutral-200">
            {latestVersion === undefined ? "no recorded version" : versionLabelFor(latestVersion, latestVersion.hash)}
          </span>
          {" · drift: "}
          <span className="font-mono text-neutral-700 dark:text-neutral-200" title={DRIFT_EXPLANATION[drift]}>
            {DRIFT_LABEL[drift]}
          </span>
        </p>
        <Link
          href={bundleFileHref(slug, path, from)}
          className="font-mono text-[11px] text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
        >
          {path}
        </Link>
      </div>
      {loading && <p className="text-xs text-neutral-500">Loading...</p>}
      {fileError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load {path}: {fileError}
        </p>
      )}
      {!loading && fileError === undefined && content !== undefined && content.length === 0 && (
        <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
          <Unrecorded word={`${path} is empty.`} />
        </p>
      )}
      {!loading && fileError === undefined && content !== undefined && content.length > 0 && (
        // SKILL.md renders as formatted markdown with a Raw toggle (#143).
        <FileContentView
          path={path}
          content={content}
          preClassName="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-canvas/50 p-3 font-mono text-xs leading-relaxed text-neutral-800 dark:text-neutral-200"
          renderedClassName="max-h-[36rem] overflow-auto rounded-md border border-border bg-canvas/50 p-3"
        />
      )}
    </section>
  );
};

const FilesTab: FC<{ slug: string; files: ReadonlyArray<string>; initialFile: string | undefined }> = ({
  slug,
  files,
  initialFile,
}) => {
  // The `?file=` deep-link wins when it names a real file (the review panel's
  // "view the changes" link lands here); otherwise default to the first file.
  const preferred = initialFile !== undefined && files.includes(initialFile) ? initialFile : files[0];
  // Only the reviewer's explicit picks live in state; everything else is
  // derived each render, so the selection can never drift out of sync with a
  // `files` list refreshed by live SSE updates (a file the reviewer picked
  // stays picked; a vanished one falls back to `preferred`).
  const [userSelected, setUserSelected] = useState<string | undefined>(undefined);
  const selected = userSelected !== undefined && files.includes(userSelected) ? userSelected : preferred;
  const { content, loading, error: fileError } = useBundleFileContent(slug, selected);

  if (files.length === 0) {
    return (
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        No source files yet — design.md, research/, and output/ appear here as each stage produces them.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <select
        value={selected ?? ""}
        onChange={(event) => setUserSelected(event.target.value)}
        className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
      >
        {files.map((path) => (
          <option key={path} value={path}>
            {path}
          </option>
        ))}
      </select>
      {loading && <p className="text-xs text-neutral-500">Loading...</p>}
      {fileError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          Could not load {selected}: {fileError}
        </p>
      )}
      {!loading && fileError === undefined && (
        // .md files (design.md, review-panel artifact deep-links) render as
        // formatted markdown with a Raw toggle (#143); other files keep the
        // plain <pre> exactly as before.
        <FileContentView
          key={selected}
          path={selected ?? ""}
          content={content ?? ""}
          preClassName="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-200 p-2 text-[11px] dark:border-neutral-800"
          renderedClassName="max-h-96 overflow-auto rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
        />
      )}
    </section>
  );
};

/**
 * The version records section (drift badge + "Record version" + history) --
 * the old Versions tab, now housed on Lineage (issue #109: version records
 * ARE custody; the old `/versions` path aliases here via the router).
 */
const VersionsSection: FC<{
  slug: string;
  drift: Drift;
  versions: ReadonlyArray<VersionRecord>;
  onRecorded: () => void;
}> = ({ slug, drift, versions, onRecorded }) => {
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [recordError, setRecordError] = useState<string | undefined>(undefined);

  const submit = (): void => {
    setPending(true);
    setRecordError(undefined);
    recordVersion(slug, label.trim().length > 0 ? label.trim() : undefined)
      .then((result) => {
        if (!result.ok) {
          setRecordError(result.error);
          return;
        }
        setLabel("");
        onRecorded();
      })
      .catch((cause: Error) => setRecordError(cause.message))
      .finally(() => setPending(false));
  };

  return (
    <section className="flex flex-col gap-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Versions</h4>
      <div className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${DRIFT_BADGE_CLASS[drift]}`}>
        {DRIFT_LABEL[drift]}
      </div>
      <p className="text-xs text-neutral-600 dark:text-neutral-300">{DRIFT_EXPLANATION[drift]}</p>

      {recordError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {recordError}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label (optional, e.g. v0.3)"
          className="w-full rounded-md border border-neutral-300 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Record version
        </button>
      </div>

      <section className="flex flex-col gap-1">
        <h5 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Version history</h5>
        <ul className="flex flex-col gap-1">
          {versions.map((version) => (
            <li key={version.hash} className="text-[11px] text-neutral-600 dark:text-neutral-300">
              <span className="font-mono">{shortHash(version.hash)}</span>{" "}
              {version.label !== undefined && <span className="font-medium">{version.label}</span>}{" "}
              <span className="text-neutral-400">{formatTimestamp(version.recordedAt)}</span>
            </li>
          ))}
          {versions.length === 0 && <li className="text-[11px] text-neutral-400">No versions recorded yet.</li>}
        </ul>
      </section>
    </section>
  );
};

/**
 * One custody event, humanized defensively from its payload (the payload is
 * `Unknown` on the wire; anything unrecognized falls back to the raw event
 * type -- display what the journal says, invent nothing).
 */
const custodyLine = (event: EventView): string => {
  const versionHash = stringField(event.payload, "versionHash");
  switch (event.type) {
    case "bundle.created":
      return "Created here";
    case "skill.routed": {
      const disposition = stringField(event.payload, "disposition") ?? "?";
      const reason = stringField(event.payload, "reason");
      return `Arrived from outside — routed "${disposition}"${reason !== undefined ? `: ${reason}` : ""}`;
    }
    case "skill.version_recorded": {
      const hash = stringField(event.payload, "hash");
      const label = stringField(event.payload, "label");
      return `Version recorded${hash !== undefined ? ` ${shortHash(hash)}` : ""}${label !== undefined ? ` ("${label}")` : ""}`;
    }
    case "skill.published": {
      const target = stringField(event.payload, "target");
      return `Published${versionHash !== undefined ? ` ${shortHash(versionHash)}` : ""}${target !== undefined ? ` to "${target}"` : ""}`;
    }
    case "skill.shipped": {
      const destination = stringField(event.payload, "destination");
      const purpose = stringField(event.payload, "purpose");
      return `Shipped${versionHash !== undefined ? ` ${shortHash(versionHash)}` : ""}${destination !== undefined ? ` to "${destination}"` : ""}${purpose !== undefined ? ` for "${purpose}"` : ""}`;
    }
    case "skill.field_report": {
      const outcome = stringField(event.payload, "outcome");
      return `Field report received${outcome !== undefined ? `: ${outcome}` : ""}`;
    }
    case "bundle.archived":
      return "Retired";
    case "bundle.restored":
      return "Restored";
    default:
      return event.type;
  }
};

/**
 * The Lineage tab (issue #109): fork family + provenance (from adopt
 * markers -- `forkOf`/`forks` link within the deck, `upstream` is where the
 * content came from before it had identity here), the chain of custody
 * replayed from the journal (oldest first -- the chain reads forward), and
 * the version records section. Display only what existing data supports:
 * no marker, no upstream, no custody events all render as honest absences.
 */
const LineageTab: FC<{
  slug: string;
  from: CardOrigin | undefined;
  lineage: LineageRecord;
  drift: Drift;
  versions: ReadonlyArray<VersionRecord>;
  onRecorded: () => void;
}> = ({ slug, from, lineage, drift, versions, onRecorded }) => (
  <section className="flex flex-col gap-4">
    <section className="flex flex-col gap-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Fork family</h4>
      <div className="flex flex-col gap-1 text-[11px] text-neutral-600 dark:text-neutral-300">
        <span>
          {lineage.forkOf === null ? (
            <span className="text-neutral-400">Not a fork of anything recorded.</span>
          ) : (
            <>
              Forked from{" "}
              <Link
                href={bundleHref(lineage.forkOf, "overview", from)}
                className="font-medium text-sky-700 hover:underline dark:text-sky-300"
              >
                {lineage.forkOf}
              </Link>
            </>
          )}
        </span>
        <span>
          {lineage.forks.length === 0 ? (
            <span className="text-neutral-400">No forks recorded.</span>
          ) : (
            <>
              Forks:{" "}
              {lineage.forks.map((fork, index) => (
                <span key={fork}>
                  {index > 0 ? ", " : ""}
                  <Link
                    href={bundleHref(fork, "overview", from)}
                    className="font-medium text-sky-700 hover:underline dark:text-sky-300"
                  >
                    {fork}
                  </Link>
                </span>
              ))}
            </>
          )}
        </span>
        {/* "Provenance", not "Upstream" (seam pass over #108/#109): the
            Research tab's dossier contexts already render "Upstream" for the
            handoff CLAIM (what hands work TO this skill); this line is the
            adopt marker's import provenance (where the files came from) --
            two different facts, so two different words, "Upstream" kept
            exclusively for the dossier's claim. */}
        <span>
          {lineage.upstream === null ? (
            <span className="text-neutral-400">Provenance: unrecorded.</span>
          ) : (
            <>
              Provenance: <span className="font-mono">{lineage.upstream.source}</span>
              {lineage.upstream.ref !== null && <span className="font-mono"> @ {lineage.upstream.ref}</span>}
            </>
          )}
        </span>
      </div>
    </section>

    <section className="flex flex-col gap-1">
      <h4 className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
        Chain of custody
      </h4>
      {lineage.custody.length === 0 ? (
        <p className="text-[11px] text-neutral-400">No custody events yet.</p>
      ) : (
        /* The prototype's dotted list: `date  humanized-line — actor` per
           row. The actor stays VISIBLE (not hover-only -- keyboard/touch
           users get it too); the full timestamp and raw event type remain
           on the row's title as a convenience duplicate, never the only
           path to anything a row doesn't already show. */
        <ol className="flex flex-col">
          {lineage.custody.map((event) => (
            <li
              key={event.id}
              className="border-b border-dotted border-border py-1.5 text-[13px] last:border-b-0"
              title={`${formatTimestamp(event.at)} · ${event.type}`}
            >
              <span className="font-mono text-neutral-400">{formatDay(event.at)}</span>{" "}
              <span className="text-neutral-700 dark:text-neutral-200">{custodyLine(event)}</span>{" "}
              <span className="text-[11px] text-neutral-400">
                — {event.actor.kind}:{event.actor.name}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>

    <VersionsSection slug={slug} drift={drift} versions={versions} onRecorded={onRecorded} />
  </section>
);

/**
 * The Coverage tab (issue #109): the risk map in its AUTHORED words only --
 * covered / partial / gap, exactly as `risk-map.md` says. Deliberately no
 * measurement chips and no pass rates here (unlike the old Evals tab):
 * coverage is authored judgment, pass rates are measurements, and the two
 * never blend. The rates live one tab over, in Models -- and each row's
 * fixture name links there (`?fixture=`, card-fidelity round 2), landing
 * on that fixture's expanded test body: the claim connected to the test
 * that buys it, without the two axes ever merging.
 */
const CoverageTab: FC<{
  slug: string;
  from: CardOrigin | undefined;
  riskCoverage: ReadonlyArray<RiskCoverageRecord>;
  warnings: ReadonlyArray<WarningRecord>;
}> = ({ slug, from, riskCoverage, warnings }) => {
  const families = RISK_FAMILY_ORDER.filter((family) => riskCoverage.some((row) => row.family === family));
  const otherFamilies = Array.from(
    new Set(riskCoverage.map((row) => row.family).filter((family) => !(RISK_FAMILY_ORDER as ReadonlyArray<string>).includes(family))),
  ).sort();
  const orderedFamilies = [...families, ...otherFamilies];

  return (
    <section className="flex flex-col gap-4">
      {warnings.length > 0 && (
        <section className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Warnings
          </h4>
          <ul className="flex flex-col gap-1">
            {warnings.map((warning, index) => (
              <li key={index} className="text-[11px] text-amber-800 dark:text-amber-300">
                <span className="font-mono">[{warning.source}]</span> {warning.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
          Risk coverage
        </h4>
        {orderedFamilies.length === 0 && (
          <p className="text-[11px] text-neutral-400">No risk-map.md authored yet.</p>
        )}
        {orderedFamilies.map((family) => (
          <div key={family} className="flex flex-col gap-1">
            <h5 className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
              {RISK_FAMILY_LABEL[family] ?? family}
            </h5>
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-neutral-400">
                  <th className="pr-2 font-normal">Risk</th>
                  <th className="pr-2 font-normal">Coverage</th>
                  <th className="pr-2 font-normal">Fixture</th>
                </tr>
              </thead>
              <tbody>
                {riskCoverage
                  .filter((row) => row.family === family)
                  .map((row) => (
                    <tr key={row.riskId} className="border-t border-neutral-100 dark:border-neutral-800">
                      {/* The claim sentence leads the row (issue #144): the
                          description IS the row -- "IN-1" means nothing to a
                          reader who has never seen the ids, so the id shrinks
                          to a small handle beside its sentence. An empty
                          Description cell renders an explicit "no
                          description", never a blank. */}
                      <td className="w-full py-1 pr-2">
                        {row.description === undefined || row.description === "" ? (
                          <span className="italic text-neutral-400">no description</span>
                        ) : (
                          <span className="text-neutral-700 dark:text-neutral-200">{row.description}</span>
                        )}{" "}
                        <span className="whitespace-nowrap font-mono text-[10px] text-neutral-400">{row.riskId}</span>
                      </td>
                      <td className="py-1 pr-2">
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${COVERAGE_PILL_CLASS[row.coverage]}`}
                        >
                          {COVERAGE_LABEL[row.coverage]}
                        </span>
                      </td>
                      <td className="py-1 pr-2 font-mono">
                        {row.fixtureCase === undefined ? (
                          "—"
                        ) : (
                          <Link
                            href={bundleFixtureHref(slug, row.fixtureCase, from)}
                            title={`Open ${row.fixtureCase}'s test body under Models`}
                            className="text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
                          >
                            {row.fixtureCase}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ))}
        {orderedFamilies.length > 0 && (
          <Footnote>Authored judgments; measured pass rates are on the Models tab.</Footnote>
        )}
      </section>
    </section>
  );
};

/**
 * Per-fixture last-run status chip (plan.md Phase 8): completed green /
 * failed red / infra-error gray / running pulse.
 */
const RUN_CHIP_STYLE: Record<RunRecord["status"], string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  "infra-error": "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  running: "animate-pulse bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
};

/**
 * One measurement chip per provider(+model) cell, for ONE fixture at the
 * CURRENT latest recorded version only (data-model.md §2.11, §1.6): a new
 * version resets validation honestly because measurements key on
 * `versionHash` -- older cells simply stop matching. "not yet measured"
 * when no completed+graded run exists for that fixture at that version.
 */
const MeasurementChips: FC<{
  measurements: ReadonlyArray<MeasurementRecord>;
  fixtureCase: string;
  latestHash: string | undefined;
  /** The recorded version at `latestHash`, if any -- Fix 4 (F6): resolves the chip's tooltip hash to its human label. */
  latestVersion?: VersionRecord;
}> = ({ measurements, fixtureCase, latestHash, latestVersion }) => {
  const cells = measurements.filter(
    (cell) => cell.fixtureCase === fixtureCase && cell.versionHash === latestHash,
  );
  if (latestHash === undefined || cells.length === 0) {
    return <span className="text-neutral-400">not yet measured</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {cells.map((cell) => {
        const providerLabel = providerModelId(cell);
        const ci = cell.ci === null ? "" : ` · ${formatCI(cell.ci)}`;
        // Fix 3 (F5): PASS% stays pass-only (passes / n); partial/fail are
        // their own counts here so a partial verdict never disappears from
        // the chip, even though it never contributes to the % numerator.
        const partialFail =
          cell.partial > 0 || cell.fail > 0 ? ` (${cell.partial} partial, ${cell.fail} fail)` : "";
        return (
          <span
            key={`${cell.provider}|${cell.model}`}
            title={`${cell.passes}/${cell.n} pass, ${cell.partial} partial, ${cell.fail} fail on ${providerLabel} at ${versionLabelFor(latestVersion, cell.versionHash)}`}
            className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
          >
            {providerLabel}: n={cell.n} · {formatPassRate(cell.passRate)}{partialFail}
            {ci}
          </span>
        );
      })}
    </span>
  );
};

/**
 * One fixture's readable TEST BODY (card-fidelity round 2: "I can't see
 * what the tests are"): what the fixture does (the task prompt --
 * `prompt.md` when present, the legacy `case.json` `prompt` field
 * otherwise) and what passing means (`grading`'s answer key + checks, in
 * their authored words). Mounted only while the row is expanded, so the
 * detail fetch (`useFixtureDetail`) is lazy by construction -- never eager
 * for every fixture. Every absent piece is an honest gap line.
 */
const FixtureTestBody: FC<{ slug: string; caseName: string }> = ({ slug, caseName }) => {
  const { detail, loading, error } = useFixtureDetail(slug, caseName);

  if (loading && detail === undefined) {
    return <p className="text-xs text-neutral-500">Loading test...</p>;
  }
  if (error !== undefined) {
    return (
      <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
        Could not load {caseName}: {error}
      </p>
    );
  }
  if (detail === undefined) {
    return null;
  }

  const prompt = detail.promptMd ?? detail.legacyPrompt;
  const grading = detail.grading;
  const hasGrading = grading !== null && (grading.answerKey !== null || grading.checks.length > 0);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-canvas/40 p-3">
      {detail.warnings.map((warning) => (
        <p key={warning} className="text-[11px] text-amber-800 dark:text-amber-300">
          [fixture] {warning}
        </p>
      ))}

      <div className="flex flex-col gap-1">
        <h5 className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
          What it does
        </h5>
        {prompt === null ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            <Unrecorded word="no prompt recorded" />
          </p>
        ) : (
          <>
            {detail.promptMd === null && (
              <p className="text-[11px] text-neutral-400">
                From the legacy <span className="font-mono">case.json</span> prompt field —{" "}
                <span className="font-mono">prompt.md</span> is the current home for task prose.
              </p>
            )}
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-2 font-mono text-xs leading-relaxed text-neutral-800 dark:text-neutral-200">
              {prompt}
            </pre>
          </>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h5 className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
          What passing means
        </h5>
        {!hasGrading ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            <Unrecorded word="no authored grading" /> — pass/fail rests on the grader&apos;s judgment of the
            prompt alone.
          </p>
        ) : (
          <>
            {grading.answerKey !== null && (
              <p className="text-xs text-neutral-700 dark:text-neutral-300">
                <span className="text-neutral-500 dark:text-neutral-400">Answer key: </span>
                {grading.answerKey}
              </p>
            )}
            {grading.checks.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {grading.checks.map((check) => (
                  <li key={check} className="text-xs text-neutral-700 dark:text-neutral-300">
                    <span className="text-neutral-400">☐</span> {check}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {detail.context !== null && (
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Context: <span className="font-mono">{detail.context}</span>
        </p>
      )}
    </div>
  );
};

/**
 * One fixture row of the read-out: header (name, class, prompt.md,
 * measurement chips, Run button + provider select when >1 provider), an
 * expandable readable test body (`FixtureTestBody`, lazy -- card-fidelity
 * round 2), plus that fixture's runs newest-first -- each run opens the
 * run-detail modal. `autoExpand` (the route's `?fixture=` param, Coverage's
 * cross-link) opens the body and scrolls the row into view; the reader can
 * still collapse it by hand afterwards.
 */
const FixtureRow: FC<{
  slug: string;
  fixture: FixtureRecord;
  runs: ReadonlyArray<RunRecord>;
  measurements: ReadonlyArray<MeasurementRecord>;
  latestHash: string | undefined;
  latestVersion?: VersionRecord;
  providers: ReadonlyArray<string>;
  autoExpand: boolean;
  onOpenRun: (runId: string) => void;
  onChanged: () => void;
}> = ({ slug, fixture, runs, measurements, latestHash, latestVersion, providers, autoExpand, onOpenRun, onChanged }) => {
  const [provider, setProvider] = useState<string>(providers[0] ?? "claude-code");
  const [expanded, setExpanded] = useState(autoExpand);
  const rowRef = useRef<HTMLLIElement | null>(null);

  // A later `?fixture=` navigation (e.g. a second Coverage cross-link while
  // already on Models) re-opens and re-scrolls; a hand-collapse afterwards
  // still sticks because this only fires when `autoExpand` turns true.
  useEffect(() => {
    if (autoExpand) {
      setExpanded(true);
      rowRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [autoExpand]);
  // Fix 1 (Phase 20 Story 2 friction log F1): the advertised model list is
  // only known once an ACP session connects (session/new's
  // models.availableModels), so this stays a free-text id rather than a
  // pre-populated <select> -- an unknown id is rejected server-side with the
  // advertised list once the session starts.
  const [model, setModel] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [runError, setRunError] = useState<string | undefined>(undefined);

  const startRun = (): void => {
    setPending(true);
    setRunError(undefined);
    triggerRun(slug, fixture.caseName, providers.length > 0 ? provider : undefined, model.trim())
      .then((result) => {
        if (!result.ok) {
          setRunError(result.error);
          return;
        }
        // The run proceeds server-side; the SSE journal stream refreshes the
        // card as run.started/run.completed land. One eager refetch so the
        // "running" chip shows up promptly.
        onChanged();
      })
      .catch((cause: Error) => setRunError(cause.message))
      .finally(() => setPending(false));
  };

  const fixtureRuns = runs.filter((run) => run.fixtureCase === fixture.caseName);

  return (
    <li ref={rowRef} className="flex flex-col gap-1 rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-300">
        <span className="font-mono font-medium text-neutral-900 dark:text-neutral-100">{fixture.caseName}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
          {fixture.class}
        </span>
        {fixture.risks.length > 0 && <span className="text-neutral-400">{fixture.risks.join(", ")}</span>}
        <span
          className={
            fixture.hasPromptMd
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-neutral-300 dark:text-neutral-600"
          }
        >
          {fixture.hasPromptMd ? "prompt.md" : "no prompt.md"}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 hover:text-neutral-900 dark:border-neutral-700 dark:text-neutral-300 dark:hover:text-neutral-100"
        >
          {expanded ? "Hide test ▾" : "View test ▸"}
        </button>
        <span className="ml-auto flex items-center gap-1">
          {providers.length > 1 && (
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="rounded-md border border-neutral-300 px-1 py-0.5 text-[10px] dark:border-neutral-700 dark:bg-neutral-900"
            >
              {providers.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          )}
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="model (optional)"
            title="Model id from the provider's advertised session/new models (e.g. default, sonnet, haiku). Leave blank for the provider's own default."
            className="w-24 rounded-md border border-neutral-300 px-1 py-0.5 text-[10px] dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            disabled={pending || !fixture.hasPromptMd}
            title={fixture.hasPromptMd ? `Run ${fixture.caseName}` : "No prompt.md to run"}
            onClick={startRun}
            className="rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
          >
            Run ▸
          </button>
        </span>
      </div>
      <div className="text-[11px]">
        <MeasurementChips
          measurements={measurements}
          fixtureCase={fixture.caseName}
          latestHash={latestHash}
          latestVersion={latestVersion}
        />
      </div>
      {expanded && <FixtureTestBody slug={slug} caseName={fixture.caseName} />}
      {runError !== undefined && (
        <p className="rounded-md bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {runError}
        </p>
      )}
      {fixtureRuns.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {fixtureRuns.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onOpenRun(run.id)}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RUN_CHIP_STYLE[run.status]}`}>
                  {run.status}
                </span>
                {run.verdict !== undefined && (
                  <span className="font-medium">{run.verdict}</span>
                )}
                <span className="text-neutral-400">{formatTimestamp(run.startedAt)}</span>
                <span className="ml-auto font-mono text-[10px] text-neutral-300 dark:text-neutral-600">
                  {run.id.slice(0, 8)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

/** One measurement row's stable identity for React keys -- the full never-pooled grouping key. */
const measurementRowKey = (cell: MeasurementRecord): string =>
  `${cell.fixtureCase}|${cell.versionHash}|${cell.provider}|${cell.model}`;

/**
 * The Models tab (issue #109): the measurements table -- one row per
 * (fixture × provider × model), each row pinned to the version it measured
 * (a version column, never a merge). NEVER pooled across fixtures,
 * versions, or models; model ids are the exact recorded strings; the CI is
 * core's Wilson/rule-of-three on the real n. The fixtures/runs read-out
 * (Run buttons + run-detail modal, `?run=` deep link) lives below the
 * table -- runs are the samples the table aggregates, so they share a tab.
 */
const ModelsTab: FC<{
  slug: string;
  fixtures: ReadonlyArray<FixtureRecord>;
  runs: ReadonlyArray<RunRecord>;
  measurements: ReadonlyArray<MeasurementRecord>;
  versions: ReadonlyArray<VersionRecord>;
  /** The open run, sourced from the route's `?run=` query param -- not local state, so it survives reload/back-forward. */
  runId: string | undefined;
  /** The auto-expanded fixture, sourced from the route's `?fixture=` query param (Coverage's cross-link) -- same reload-survival as `runId`. */
  fixtureParam: string | undefined;
  onOpenRun: (runId: string) => void;
  onCloseRun: () => void;
  onChanged: () => void;
}> = ({ slug, fixtures, runs, measurements, versions, runId, fixtureParam, onOpenRun, onCloseRun, onChanged }) => {
  const { state } = useWorkspace();
  const providers = state?.config.providers ?? [];
  // Versions arrive newest-first; the fixture chips below only count against
  // the CURRENT latest recorded version (data-model.md §1.6's honest reset).
  const latestVersion = versions[0];
  const latestHash = latestVersion?.hash;

  const versionByHash = new Map(versions.map((version) => [version.hash, version]));
  const versionRank = new Map(versions.map((version, index) => [version.hash, index]));
  const rows = [...measurements].sort(
    (a, b) =>
      a.fixtureCase.localeCompare(b.fixtureCase) ||
      (versionRank.get(a.versionHash) ?? Number.MAX_SAFE_INTEGER) -
        (versionRank.get(b.versionHash) ?? Number.MAX_SAFE_INTEGER) ||
      providerModelId(a).localeCompare(providerModelId(b)),
  );

  return (
    <section className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
          Model performance
        </h4>
        {rows.length === 0 ? (
          <p className="text-[11px] text-neutral-400">
            No measurements yet — a measurement is a set of graded runs at a recorded version.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-neutral-400">
                  <th className="pr-2 font-normal">Fixture</th>
                  <th className="pr-2 font-normal">Provider</th>
                  <th className="pr-2 font-normal">Model</th>
                  <th className="pr-2 font-normal">Version</th>
                  <th className="pr-2 font-normal">n</th>
                  <th className="pr-2 font-normal">Pass</th>
                  <th className="pr-2 font-normal">Rate</th>
                  <th className="pr-2 font-normal">95% CI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((cell) => (
                  <tr key={measurementRowKey(cell)} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-1 pr-2 font-mono">{cell.fixtureCase}</td>
                    <td className="py-1 pr-2 font-mono">{cell.provider}</td>
                    {/* The pinned model NAME, visually accented (prototype `.pin`): the recorded string blurb-stripped for display (#141) -- hover exposes the exact full stored value. */}
                    <td className="py-1 pr-2 font-mono text-amber-700 dark:text-amber-400" title={cell.model}>
                      {cell.model.length > 0 ? (
                        modelDisplayName(cell.model)
                      ) : (
                        <span className="text-neutral-400" title="The run recorded no model id.">
                          (unrecorded)
                        </span>
                      )}
                    </td>
                    <td className="py-1 pr-2 font-mono" title={cell.versionHash}>
                      {versionLabelFor(versionByHash.get(cell.versionHash), cell.versionHash)}
                      {cell.versionHash === latestHash ? "" : " (older)"}
                    </td>
                    <td className="py-1 pr-2">{cell.n}</td>
                    <td className="py-1 pr-2">
                      {cell.passes}/{cell.n}
                      {cell.partial > 0 || cell.fail > 0
                        ? ` (${cell.partial} partial, ${cell.fail} fail)`
                        : ""}
                    </td>
                    <td className="py-1 pr-2">{formatPassRate(cell.passRate)}</td>
                    <td className="py-1 pr-2">{formatCI(cell.ci)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Fixtures &amp; runs</h4>
        <ul className="flex flex-col gap-2">
          {fixtures.map((fixture) => (
            <FixtureRow
              key={fixture.caseName}
              slug={slug}
              fixture={fixture}
              runs={runs}
              measurements={measurements}
              latestHash={latestHash}
              latestVersion={latestVersion}
              providers={providers}
              autoExpand={fixtureParam === fixture.caseName}
              onOpenRun={onOpenRun}
              onChanged={onChanged}
            />
          ))}
          {fixtures.length === 0 && <li className="text-[11px] text-neutral-400">No fixtures yet.</li>}
        </ul>
      </section>

      {runId !== undefined && (
        <RunDetailModal slug={slug} runId={runId} onClose={onCloseRun} onGraded={onChanged} />
      )}
    </section>
  );
};
