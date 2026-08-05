/**
 * PROTOTYPE — Status (2026-08-05). Formerly the Board.
 *
 * WHY THE STAGE COLUMNS ARE GONE. The adopted vision already ruled it:
 * "Board — the top level. All skills, the portfolio view... **stage is a
 * field on the skill, not a room it visits**" (`Vision - The Skill Is the
 * Product`). The five-column kanban that shipped came from the IA doc one
 * day later, which specced "columns = the full ladder" — reinstating the
 * exact rooms the vision had just abolished. A kanban also fails on its own
 * terms for maintenance: "GitHub doesn't drag a repo across a kanban when
 * you fix a bug — the issue moves, not the repo" (stock-and-flow, #80).
 *
 * WHAT THIS SURFACE IS, AND ISN'T. Director's line: it can't just be a list
 * of everything, because Projects → skills in the sidebar already is that.
 * So Status shows what the sidebar can't: not WHICH skills exist, but WHERE
 * EACH ONE STANDS.
 *
 *   Status  facts about a skill — state, not work
 *   Tasks   things to do — wanted pieces, reviews, todos
 *
 * That line is why open-todo counts and awaiting-review are deliberately
 * NOT here, though both are on the wire. They're work, and work has a home.
 * Putting them here would make Status into Tasks wearing a hat.
 *
 * THE TWO DRIFTS, both already computed by the server:
 *
 *   live drift       `bundle.drift` — working files vs the last RECORDED
 *                    version. "I've changed things since I stamped one."
 *                    (Versions.ts:295 — no-version | in-sync |
 *                    design-changed | output-hand-edited | both)
 *   installed drift  `publish.targets[].installedDrift` — the PUBLISHED
 *                    copy, where an agent actually reads it, vs the version
 *                    last published. "Is what's out there still what I
 *                    sent?" (not-installed | in-sync | installed-edited)
 *
 * The second one is the closest thing this product has to a signal from
 * outside itself, and nothing has ever led with it. It is the honest,
 * shipped-today half of the telemetry the director is punting on: it can
 * say where a skill is and whether it's current, but not yet how it's
 * DOING out there. That hole is drawn, not filled.
 *
 * A note on the inward/outward cut showing up again: everything on this
 * surface concerns Prompt and Evals — the two pieces that leave. Job and
 * Method never go anywhere, so they have no status beyond written-or-not,
 * which the skill's own card already says.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchProjects, useApiData } from "../next/api.ts";
import { apiPath, setActiveProject } from "../runtime/projectScope.ts";
import type { Project } from "../next/types.ts";

const CODE = "[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";
const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted";

type Live = "no-version" | "in-sync" | "design-changed" | "output-hand-edited" | "both" | null;
type Installed = "not-installed" | "in-sync" | "installed-edited" | null;

type Standing = {
  readonly slug: string;
  readonly project: Project;
  /** Where the published copy lives, `~`-shortened. Null = never published. */
  readonly installedAt: string | null;
  readonly installedDrift: Installed;
  /** Short hash of the version last published there. */
  readonly publishedVersion: string | null;
  readonly liveDrift: Live;
  /** Short hash of the latest recorded version; null = none recorded. */
  readonly latestVersion: string | null;
  /** Models with at least one passing graded run. */
  readonly provenOn: ReadonlyArray<string>;
  readonly claimsCovered: number;
  readonly claimsTotal: number;
};

/** One bundle-detail fetch per skill. Fine at this size; would want a
 *  workspace-level rollup endpoint before it grew. */
const fetchStanding = async (slug: string, project: Project): Promise<Standing> => {
  const response = await fetch(apiPath(`/api/bundles/${encodeURIComponent(slug)}`));
  if (!response.ok) throw new Error(`bundle: ${response.status}`);
  const b = (await response.json()) as {
    bundle?: { drift?: unknown };
    versions?: ReadonlyArray<{ hash?: unknown }>;
    riskCoverage?: ReadonlyArray<{ coverage?: unknown }>;
    measurements?: ReadonlyArray<{ model?: unknown; passes?: unknown }>;
    publish?: {
      targets?: ReadonlyArray<{
        remembered?: unknown;
        displayPath?: unknown;
        installedDrift?: unknown;
        lastPublished?: { versionHash?: unknown } | null;
      }>;
    };
  };

  const short = (h: unknown) => (typeof h === "string" ? h.replace(/^sha256:/, "").slice(0, 8) : null);
  const remembered = (b.publish?.targets ?? []).filter((t) => t.remembered === true);
  const first = remembered[0];
  const coverage = b.riskCoverage ?? [];

  return {
    slug,
    project,
    installedAt: typeof first?.displayPath === "string" ? first.displayPath : null,
    installedDrift: (first?.installedDrift ?? null) as Installed,
    publishedVersion: short(first?.lastPublished?.versionHash),
    liveDrift: (b.bundle?.drift ?? null) as Live,
    latestVersion: short((b.versions ?? [])[0]?.hash),
    provenOn: [
      ...new Set(
        (b.measurements ?? [])
          .filter((m) => typeof m.passes === "number" && m.passes > 0 && typeof m.model === "string")
          .map((m) => m.model as string),
      ),
    ],
    claimsCovered: coverage.filter((r) => r.coverage !== "gap").length,
    claimsTotal: coverage.length,
  };
};

export function ProtoStatus({ onOpenSkill }: { readonly onOpenSkill: (project: Project, slug: string) => void }) {
  const projects = useApiData(fetchProjects, [] as ReadonlyArray<Project>);
  const [rows, setRows] = useState<ReadonlyArray<Standing>>([]);

  const load = useCallback(async () => {
    const pairs = projects.flatMap((p) => p.skills.map((s) => ({ project: p, slug: s.slug })));
    const out: Standing[] = [];
    for (const { project, slug } of pairs) {
      setActiveProject(project.slug); // bundle routes are project-scoped
      try {
        out.push(await fetchStanding(slug, project));
      } catch {
        // a skill whose detail won't load is skipped, never invented
      }
    }
    setRows(out);
  }, [projects]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl">Status</h1>
      <p className="max-w-2xl pb-5 pt-1 text-sm leading-relaxed text-ink-muted">
        Where each skill stands — what&rsquo;s out there, whether it&rsquo;s current, and what it&rsquo;s proven on. Work lives in
        Tasks; this is state.
      </p>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <div className="flex items-baseline gap-3 border-b border-border px-3 py-2">
          <span className={`${LABEL} flex-1`}>Skill</span>
          <span className={`${LABEL} w-56 shrink-0`}>Out there</span>
          <span className={`${LABEL} w-40 shrink-0`}>Here</span>
          <span className={`${LABEL} w-44 shrink-0`}>Proven</span>
        </div>

        {rows.map((r) => (
          <button
            key={`${r.project.slug}/${r.slug}`}
            type="button"
            onClick={() => {
              setActiveProject(r.project.slug);
              onOpenSkill(r.project, r.slug);
            }}
            className="flex w-full items-baseline gap-3 border-b border-border/60 px-3 py-2.5 text-left last:border-b-0 hover:bg-well/60"
          >
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${CODE} text-[13px] text-ink`}>{r.slug}</span>
              <span className="block truncate text-[11px] text-ink-muted">{r.project.name}</span>
            </span>

            {/* OUT THERE — the published copy, and whether it still matches */}
            <span className="w-56 shrink-0">
              <OutThere row={r} />
            </span>

            {/* HERE — have I moved since the last recorded version */}
            <span className="w-40 shrink-0">
              <Here row={r} />
            </span>

            {/* PROVEN — evidence, honestly empty when there is none */}
            <span className="w-44 shrink-0">
              {r.provenOn.length === 0 ? (
                <span className="text-[12px] text-ink-muted">not measured</span>
              ) : (
                <span className="block truncate text-[12px] text-ink">{r.provenOn.join(", ")}</span>
              )}
              {r.claimsTotal > 0 && (
                <span className="block text-[11px] text-ink-muted">
                  {r.claimsCovered} of {r.claimsTotal} risks covered
                </span>
              )}
            </span>
          </button>
        ))}

        {rows.length === 0 && <p className="px-3 py-3 text-[13px] text-ink-muted">Nothing to report yet.</p>}
      </div>

      {/* the hole, drawn rather than filled */}
      <div className="mt-3 max-w-2xl rounded border border-dashed border-border bg-canvas/40 p-3">
        <p className={LABEL}>Not here yet</p>
        <p className="pt-1 text-[13px] leading-relaxed text-ink">
          How it&rsquo;s <em>doing</em> out there — which evals are live where, and whether they&rsquo;re passing. Those results live
          in the playground we don&rsquo;t run, so this surface can say where a skill is and whether it&rsquo;s current, but not yet
          how it&rsquo;s performing.
        </p>
      </div>
    </div>
  );
}

function OutThere({ row }: { readonly row: Standing }) {
  if (row.installedAt === null) {
    return <span className="text-[12px] text-ink-muted">never published</span>;
  }
  const tone =
    row.installedDrift === "installed-edited"
      ? "text-amber-800"
      : row.installedDrift === "not-installed"
        ? "text-red-700"
        : "text-emerald-700";
  const word =
    row.installedDrift === "installed-edited"
      ? "edited out there"
      : row.installedDrift === "not-installed"
        ? "missing"
        : "in sync";
  return (
    <>
      <span className={`block text-[12px] ${tone}`}>
        {word}
        {row.publishedVersion !== null && <span className="text-ink-muted"> · {row.publishedVersion}</span>}
      </span>
      <span className={`block truncate ${CODE} text-[11px] text-ink-muted`}>{row.installedAt}</span>
    </>
  );
}

function Here({ row }: { readonly row: Standing }) {
  const label: Record<NonNullable<Live>, string> = {
    "no-version": "no version recorded",
    "in-sync": "matches last version",
    "design-changed": "design changed",
    "output-hand-edited": "prompt hand-edited",
    both: "design + prompt changed",
  };
  if (row.liveDrift === null) return <span className="text-[12px] text-ink-muted">—</span>;
  const moved = row.liveDrift !== "in-sync";
  return (
    <>
      <span className={`block text-[12px] ${moved ? "text-amber-800" : "text-emerald-700"}`}>{label[row.liveDrift]}</span>
      {row.latestVersion !== null && <span className={`block ${CODE} text-[11px] text-ink-muted`}>{row.latestVersion}</span>}
    </>
  );
}
