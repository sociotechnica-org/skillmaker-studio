/**
 * THE MERGE tranche 2: response extraction moved to `@skillmaker/runner`
 * (the runner writes `runs/<id>/response.md`). Re-exported here so core's
 * internal relative imports and `@skillmaker/core`'s public API are
 * unchanged.
 */
export { extractResponseText, responseMarkdown } from "@skillmaker/runner";
