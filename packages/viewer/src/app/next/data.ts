/**
 * Empty defaults shaped by the domain types — what every surface renders
 * until (or unless) the API answers. There is deliberately NO demo data
 * here: placeholder projects shipped to production once and a fresh
 * install whose /api/projects failed rendered them as if they were the
 * user's own (2026-07-28, first Windows field report). Real projects are
 * cheap to create now; test against those.
 */
import type { Project, SkillPage, Task } from "./types.ts";

export const PROJECTS: ReadonlyArray<Project> = [];

export const TASKS: ReadonlyArray<Task> = [];

export const BUNDLE_FILES: ReadonlyArray<string> = [];

/** Empty Skill page skeleton until the API answers (or when it's absent). */
export const SKILL_PAGE: SkillPage = {
  name: "",
  oneLiner: "",
  versions: [],
  // No live loop facts: the review card and advance controls stay hidden.
  loop: null,
  instructions: "",
  stage: "Idea",
  versionShort: null,
  drift: "",
  provenOn: "",
  coverage: "",
  claims: [],
  // No live runs/measurements: the tree renders claims-only and inert.
  evals: null,
  events: [],
};
