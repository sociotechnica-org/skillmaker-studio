/**
 * `trigger`-class fixture grading (`Fixtures.ts`'s `FIXTURE_CLASSES`, Phase
 * 12 plan.md's trigger-rate fold-in #2): a trigger fixture's `prompt.md`
 * deliberately does not name the skill, so the pass/fail question isn't "did
 * the agent do the task correctly" but "did the skill activate on its own."
 *
 * `didSkillActivate` scans a run's already-parsed `transcript.jsonl`
 * (`TranscriptEntry[]`, or any structurally-compatible `unknown[]` -- the
 * server's `handleRunDetail` parses the file defensively without importing
 * `AcpClient.ts`'s type) for evidence the agent invoked/read the bundle's
 * skill. Deliberately provider-tolerant rather than pattern-matching one
 * exact wire shape, because the two providers spiked so far surface skill
 * use differently:
 *
 * - claude-code-acp exposes a first-class `Skill` tool; its `tool_call`/
 *   `tool_call_update` updates name the tool and the invoked skill.
 * - codex-acp has no dedicated skill tool -- it reads the skill file with
 *   its native `Read`/shell tool instead (`spike-codex/FINDINGS.md`,
 *   confirmed live: a `tool_call` with `kind: "read"`, `title: "Read file
 *   '<sandbox>/.agents/skills/<slug>/SKILL.md'"`).
 *
 * Both shapes leave a detectable trace: either the literal word "skill"
 * alongside the slug, or a path ending in `<slug>/SKILL.md`. Serializing
 * each `tool_call`/`tool_call_update` update to a lowercase string and
 * substring-matching against both keeps this simple and catches both
 * observed shapes without hardcoding one adapter's exact field names --
 * matching `AcpClient.ts`'s general approach of treating adapter wire
 * shapes tolerantly rather than by strict schema.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Pulls the `session/update` `update` object out of one transcript line, or `undefined` if this line isn't a tool_call-shaped `session/update` notification. */
const toolCallUpdatePayload = (entry: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(entry)) return undefined;
  const message = entry.message ?? entry;
  if (!isRecord(message)) return undefined;
  if (message.method !== "session/update") return undefined;
  const params = message.params;
  if (!isRecord(params)) return undefined;
  const update = params.update;
  if (!isRecord(update)) return undefined;
  const kind = update.sessionUpdate;
  if (kind !== "tool_call" && kind !== "tool_call_update") return undefined;
  return update;
};

/**
 * `true` if the parsed `transcript.jsonl` contains a `tool_call`/
 * `tool_call_update` update that names `slug`'s skill (a `Skill` tool
 * invocation, or a read of `.../<slug>/SKILL.md`). `transcript` is the same
 * array shape `handleRunDetail` (Server.ts) and `RunEngine`/`StationEngine`
 * write/read: each element is a `{t, dir, message}` `TranscriptEntry`, or --
 * tolerantly -- the bare `message` itself.
 */
export const didSkillActivate = (transcript: ReadonlyArray<unknown>, slug: string): boolean => {
  const needle = slug.toLowerCase();
  const skillMdSuffixes = [`/${needle}/skill.md`, `${needle}/skill.md`];
  for (const entry of transcript) {
    const update = toolCallUpdatePayload(entry);
    if (update === undefined) continue;
    const haystack = JSON.stringify(update).toLowerCase();
    if (skillMdSuffixes.some((suffix) => haystack.includes(suffix))) return true;
    if (haystack.includes('"skill"') && haystack.includes(needle)) return true;
  }
  return false;
};
