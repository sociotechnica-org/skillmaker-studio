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
      // Guard against the white FOUC flash that browsers paint during
      // full-page navigation on this dark-only site: the default UA canvas
      // is white, and Starlight's own dark background/color-scheme only
      // land once the external stylesheet finishes loading. Injecting these
      // tags first in <head> (ahead of the theme-select script and the
      // stylesheet <link>, both hardcoded after Starlight's <Head/> in
      // Page.astro) means the very first paint already uses the dark
      // canvas, so there's nothing to flash from.
      head: [
        {
          tag: "meta",
          attrs: { name: "color-scheme", content: "dark" },
        },
        {
          tag: "style",
          content: "html{background-color:#17181c}",
        },
      ],
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
            { label: "Adopting an existing repo", slug: "getting-started/adopting-an-existing-repo" },
            { label: "Provider auth & troubleshooting", slug: "getting-started/provider-auth" },
            { label: "Desktop app", slug: "getting-started/desktop-app" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "The Skill Bundle", slug: "concepts/skill-bundle" },
            { label: "The production state machine", slug: "concepts/state-machine" },
            { label: "The journal", slug: "concepts/journal" },
            { label: "Versions and drift", slug: "concepts/versions-and-drift" },
            { label: "Publishing and the skillbook", slug: "concepts/publishing-and-the-skillbook" },
          ],
        },
        {
          label: "Evals",
          items: [
            { label: "Fixtures and risk maps", slug: "evals/fixtures-and-risk-maps" },
            { label: "Coverage vs. validation", slug: "evals/coverage-vs-validation" },
            { label: "Running fixtures", slug: "evals/running-fixtures" },
            { label: "Grading and measurements", slug: "evals/grading-and-measurements" },
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
            { label: "review resolve", slug: "cli/review-resolve" },
            { label: "advance", slug: "cli/advance" },
            { label: "todo", slug: "cli/todo" },
            { label: "version record", slug: "cli/version-record" },
            { label: "fixture add", slug: "cli/fixture-add" },
            { label: "run", slug: "cli/run" },
            { label: "run repair", slug: "cli/run-repair" },
            { label: "grade", slug: "cli/grade" },
            { label: "measurements", slug: "cli/measurements" },
            { label: "adopt", slug: "cli/adopt" },
            { label: "publish", slug: "cli/publish" },
            { label: "book build", slug: "cli/book-build" },
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
