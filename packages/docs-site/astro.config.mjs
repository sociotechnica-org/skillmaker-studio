import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// Docs site: static Starlight build, no analytics, minimal customization
// beyond title + GitHub link (plan.md Phase 13). Deployed alongside the
// marketing site.
export default defineConfig({
  output: "static",
  site: "https://docs.skillmaker.studio",
  integrations: [
    starlight({
      title: "Skillmaker Studio Docs",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/sociotechnica-org/skillmaker-studio",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/sociotechnica-org/skillmaker-studio/edit/main/packages/docs-site/",
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started/introduction" },
            { label: "Install from source", slug: "getting-started/install" },
            { label: "Your first Skill Bundle", slug: "getting-started/first-bundle" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "The Skill Bundle", slug: "concepts/skill-bundle" },
            { label: "The production state machine", slug: "concepts/state-machine" },
            { label: "The journal", slug: "concepts/journal" },
            { label: "Versions and drift", slug: "concepts/versions-and-drift" },
          ],
        },
        {
          label: "Evals",
          items: [
            { label: "Fixtures and risk maps", slug: "evals/fixtures-and-risk-maps" },
            { label: "Coverage vs. validation", slug: "evals/coverage-vs-validation" },
            { label: "Running fixtures", slug: "evals/running-fixtures" },
          ],
        },
        {
          label: "CLI Reference",
          items: [
            { label: "Overview", slug: "cli" },
            { label: "init", slug: "cli/init" },
            { label: "new", slug: "cli/new" },
            { label: "list", slug: "cli/list" },
            { label: "status", slug: "cli/status" },
            { label: "reindex", slug: "cli/reindex" },
            { label: "start", slug: "cli/start" },
            { label: "review request", slug: "cli/review-request" },
            { label: "advance", slug: "cli/advance" },
            { label: "todo", slug: "cli/todo" },
            { label: "version record", slug: "cli/version-record" },
            { label: "fixture add", slug: "cli/fixture-add" },
            { label: "run", slug: "cli/run" },
          ],
        },
        {
          label: "Contributing",
          items: [
            { label: "Repo layout", slug: "contributing/repo-layout" },
            { label: "Build discipline", slug: "contributing/build-discipline" },
          ],
        },
        {
          label: "Roadmap",
          items: [{ label: "What's coming next", slug: "roadmap" }],
        },
      ],
    }),
  ],
});
