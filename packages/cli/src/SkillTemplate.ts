/**
 * The `/skillmaker` skill's `SKILL.md` content, embedded at bundle time
 * (bun's `type: "text"` import attribute) so `skillmaker init`'s
 * repo-local skill registration (`Harness.ts`'s `registerSkill`, spec
 * Phase B.7) works identically whether run via `bun run`, a standalone
 * checkout, or the `bun build --compile` binary shipped through npm -- no
 * filesystem lookup relative to the running binary required.
 * `packages/skill/skillmaker/SKILL.md` is the source of truth for
 * humans/review (and for `skillmaker publish`'s marketplace path, Phase
 * B.8); this module is what actually gets installed by `init`.
 */
import content from "../../skill/skillmaker/SKILL.md" with { type: "text" };

export const SKILLMAKER_SKILL_MD: string = content;
