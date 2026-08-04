Updated [publish.md](/home/daytona/workspace/skillmaker-studio/packages/docs-site/src/content/docs/cli/publish.md) to lead with the current install door:

- `--to user|project`, resolved install paths, remembered per-bundle audiences, and bare re-publishes
- snapshot-based `--version` revert behavior, stage and drift guards
- `--json` success/rejection shapes, provenance stamp, evidence, journaling, and idempotent no-ops
- adopted in-place exception
- retained the workspace configured-target path under a clearly labeled legacy/secondary section, including all three target types and `--target`
- kept coherent links to the first-bundle publish section and Publishing and the Skillbook

Regenerated the docs site output, including [the rendered publish page](/home/daytona/workspace/skillmaker-studio/packages/docs-site/dist/cli/publish/index.html).

Validation passed:

- `bun run --filter @skillmaker/docs-site check`
- `bun run build:docs`
- `bunx tsc --noEmit -p packages/core`
- `bunx tsc --noEmit -p packages/cli`
- `bun test packages`
- `bun test test/e2e --timeout 30000`

`git diff --check` is clean. The generated docs build updates 51 files (primarily rendered pages and Pagefind assets); the authored change is the publish reference page.