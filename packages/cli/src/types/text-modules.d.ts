// Ambient module declarations for bun's `with { type: "text" }` import
// attribute (`SkillTemplate.ts` embeds `packages/skill/skillmaker/SKILL.md`
// this way so it's bundled into `bun build --compile` binaries with no
// runtime filesystem lookup). TypeScript has no built-in typing for text
// imports, so this file supplies one, scoped to `.md`.
declare module "*.md" {
  const content: string;
  export default content;
}
