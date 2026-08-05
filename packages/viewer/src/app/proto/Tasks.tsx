/**
 * PROTOTYPE — Tasks (2026-08-05). One job, one list.
 *
 * Director: "what's the simplest way we can do this? No kanban. Super
 * simple. The best way to have something that's job-to-be-done is: work
 * done by agent, ready for human review."
 *
 * So Tasks is a review queue and nothing else. No columns, no swimlanes, no
 * status vocabulary to learn. A card appears when a station finishes and
 * holds for a human; it disappears when that human decides. That is the
 * whole surface.
 *
 * WHY THIS IS THE RIGHT UNIT. It's the only moment in the product where the
 * work genuinely cannot proceed without a person — everything else is
 * either the maker's own choosing (a wanted piece on a skill's card) or
 * something an agent can carry on with. A queue of "you, specifically, now"
 * is short by construction, which is why it can be a list.
 *
 * WHAT A GOOD CARD NEEDS. Director: "if we have good cards it'll help
 * people do good reviews." A reviewer needs three things without leaving
 * the page — whose work this is, what it asked, and what it produced — and
 * then the decision. The shipping `ReviewSurface` already renders all four,
 * and resolves through the real `resolveReview` -- so approving here does
 * exactly what approving anywhere else does.
 *
 * DELIBERATELY NOT HERE: todos, and pieces a maker asked for. A wanted
 * piece isn't work done — it's work desired, and it lives on that skill's
 * own card until something fires it. Mixing "I'd like this eventually" into
 * a queue that means "you are the blocker right now" is what made every
 * previous version of this surface feel like homework.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchProjects, fetchSkillPage, useApiData } from "../next/api.ts";
import { setActiveProject } from "../runtime/projectScope.ts";
import { ReviewSurface } from "../next/ReviewSurface.tsx";
import type { Project, SkillLoop } from "../next/types.ts";

const CODE = "[font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

type Waiting = { readonly skill: string; readonly project: Project; readonly loop: SkillLoop };

export function ProtoTasks({ onOpenSkill }: { readonly onOpenSkill: (project: Project, slug: string) => void }) {
  const projects = useApiData(fetchProjects, [] as ReadonlyArray<Project>);
  const [waiting, setWaiting] = useState<ReadonlyArray<Waiting>>([]);
  const [loaded, setLoaded] = useState(false);

  // `awaitingReview` already rides the projects payload, so finding the
  // queue costs nothing; only the skills actually holding get a detail
  // fetch for their question and artifacts.
  const load = useCallback(async () => {
    const out: Waiting[] = [];
    for (const project of projects) {
      for (const skill of project.skills) {
        if (skill.awaitingReview !== true) continue;
        setActiveProject(project.slug);
        try {
          const page = await fetchSkillPage(skill.slug);
          if (page.loop !== null) out.push({ skill: skill.slug, project, loop: page.loop });
        } catch {
          // a skill whose detail won't load is skipped, never invented
        }
      }
    }
    setWaiting(out);
    setLoaded(true);
  }, [projects]);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return (
    <div className="p-6">
      <h1 className="pb-4 font-display text-2xl">Tasks</h1>

      <div className="flex max-w-2xl flex-col gap-3">
        {waiting.map((w) => (
          <ReviewCard key={w.skill} waiting={w} onOpenSkill={onOpenSkill} />
        ))}
        {loaded && waiting.length === 0 && <p className="text-sm text-ink-muted">Nothing waiting on you.</p>}
      </div>
    </div>
  );
}

/**
 * The card is the shipping `ReviewSurface` — which already renders exactly
 * what a reviewer needs (what was asked, what it produced, a notes field,
 * Approve / Send back with notes) and resolves through the real
 * `resolveReview`. The only thing it lacks on a cross-skill queue is which
 * skill it belongs to, so that's all this adds.
 *
 * First attempt used `AdvanceControls` and rendered a card with no buttons:
 * that component is the stage-ADVANCE control, and it correctly renders
 * nothing while a review is pending. Caught by driving the browser.
 */
function ReviewCard({
  waiting,
  onOpenSkill,
}: {
  readonly waiting: Waiting;
  readonly onOpenSkill: (project: Project, slug: string) => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setActiveProject(waiting.project.slug);
          onOpenSkill(waiting.project, waiting.skill);
        }}
        className={`pb-1 ${CODE} text-[13px] text-ink-muted hover:text-ink`}
      >
        {waiting.skill}
      </button>
      <ReviewSurface loop={waiting.loop} />
    </div>
  );
}
