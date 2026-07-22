/**
 * The CLI's compact model display form (issue #141). Adapters may record a
 * full display string with a marketing blurb after a "·" separator
 * ("Opus 4.6 · Most capable for complex work"); every human-readable CLI
 * surface (run/station summaries, the measurements table, the skillbook's
 * HTML receipts) shows the model NAME only -- everything from the first
 * "·" dropped, trimmed. Display-layer only: stored run.json/journal values
 * and JSON outputs keep the exact full string, and this never touches
 * model extraction (`extractModelTolerant`) or provider profiles.
 *
 * The viewer has its own copy (`cardGlance.ts`'s `modelDisplayName`) --
 * the viewer deliberately does not depend on CLI/core code.
 */
export const modelDisplayName = (model: string): string => {
  const separator = model.indexOf("·");
  return separator === -1 ? model : model.slice(0, separator).trim();
};
