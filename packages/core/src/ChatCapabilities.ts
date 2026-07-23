/**
 * Chat capability mapping (Phase: model picker / effort / images), from the
 * 2026-07 adapter spike against the SHIPPED adapters:
 *
 * - `@zed-industries/claude-code-acp@0.16.2` (the pinned claude provider):
 *   `session/new` returns `models: {availableModels: [{modelId, name,
 *   description}], currentModelId}`; the wire method `session/set_model`
 *   (SDK 0.14.1's `AGENT_METHODS.session_set_model`, JS binding
 *   `unstable_setSessionModel`) switches the model at any point -- including
 *   immediately after `session/new`, i.e. "model at session start". There
 *   is NO effort/reasoning-level door of any kind: model ids are plain
 *   aliases (`default`, `sonnet`, `opus`...), and thinking budget is only
 *   reachable via the adapter's `MAX_THINKING_TOKENS` env var -- not a
 *   per-session protocol surface. Effort is therefore NOT offered for
 *   claude models (degraded-hidden, no fakery).
 * - `@agentclientprotocol/codex-acp` (1.1.x): `session/new` returns the
 *   same `models` state shape, but every `availableModels` entry is a
 *   MODELxEFFORT variant -- `modelId` is `"<model>[<effort>]"` (e.g.
 *   `gpt-5.2-codex[medium]`), `name` is `"<display> (<effort>)"`. The
 *   adapter ALSO exposes `configOptions` entries `{id: "model"}` and
 *   `{id: "reasoning_effort"}` (`session/set_config_option`), and still
 *   answers the legacy `session/set_model` method with a bracketed id --
 *   which is the door this codebase uses (one method, both providers).
 * - Images: BOTH adapters advertise `promptCapabilities.image: true` in
 *   `initialize`, and both accept `{type: "image", data: <base64>,
 *   mimeType}` content blocks in `session/prompt` (claude forwards them as
 *   Anthropic base64 image sources; codex converts to data URLs).
 *
 * This module is the PURE half: decoding `initialize` + `session/new`
 * results into a per-provider catalog (base models grouped, efforts split
 * out of bracketed ids), composing bracketed ids back for `set_model`, and
 * building/validating `session/prompt` content blocks with images. The
 * probing half (spawn -> initialize -> session/new -> close) lives in the
 * server's ChatSessions manager, which caches per process.
 */

// ---------------------------------------------------------------------------
// Model id parsing / composition (codex's `model[effort]` convention)
// ---------------------------------------------------------------------------

/** Splits a possibly-bracketed model id: `"gpt-5.2[high]"` -> base + effort; a plain id -> base only. */
export const parseModelId = (modelId: string): { readonly model: string; readonly effort?: string } => {
  const match = /^(?<model>[^[]+?)\[(?<effort>[^\]]+)\]$/.exec(modelId);
  const model = match?.groups?.model;
  const effort = match?.groups?.effort;
  if (model !== undefined && effort !== undefined) return { model, effort };
  return { model: modelId };
};

/** Composes the wire model id for `session/set_model`: with an effort -> codex's `model[effort]`; without -> the id verbatim (claude's plain aliases). */
export const composeModelId = (modelId: string, effort?: string): string =>
  effort !== undefined && effort.length > 0 ? `${modelId}[${effort}]` : modelId;

// ---------------------------------------------------------------------------
// Catalog shapes
// ---------------------------------------------------------------------------

/** One selectable BASE model (effort variants folded into `efforts`). */
export interface ChatCatalogModel {
  /** Base model id (bracket-free) -- what the UI selects; compose with an effort for the wire. */
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  /** Effort levels this model supports (codex), in adapter order. Empty -> the effort UI hides. */
  readonly efforts: ReadonlyArray<string>;
  readonly defaultEffort?: string;
}

export interface ChatProviderCatalogEntry {
  readonly provider: string;
  /** Human section header ("Claude Code" / "Codex"). */
  readonly title: string;
  readonly models: ReadonlyArray<ChatCatalogModel>;
  /** The adapter's current default, base-id + effort split. */
  readonly currentModelId?: string;
  readonly currentEffort?: string;
  /** `initialize`'s `promptCapabilities.image`. When the probe failed entirely this defaults TRUE (both shipped adapters support images); `probed: false` says how much to trust it. */
  readonly imageSupport: boolean;
  /** False when the adapter could not be probed (spawn/init/session failure) -- models is then empty and the UI falls back to the bare provider name. */
  readonly probed: boolean;
  readonly note?: string;
}

const PROVIDER_TITLES: Readonly<Record<string, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

export const providerTitle = (provider: string): string => PROVIDER_TITLES[provider] ?? provider;

// ---------------------------------------------------------------------------
// Mapping initialize + session/new results -> catalog entry
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Reads `agentCapabilities.promptCapabilities.image` tolerantly; absent/malformed -> false (the spec default). */
export const readImageCapability = (init: unknown): boolean => {
  if (!isRecord(init)) return false;
  const caps = init.agentCapabilities;
  if (!isRecord(caps)) return false;
  const prompt = caps.promptCapabilities;
  return isRecord(prompt) && prompt.image === true;
};

interface WireModel {
  readonly modelId: string;
  readonly name?: string;
  readonly description?: string;
}

const readAvailableModels = (session: unknown): ReadonlyArray<WireModel> => {
  if (!isRecord(session) || !isRecord(session.models)) return [];
  const raw = session.models.availableModels;
  if (!Array.isArray(raw)) return [];
  const out: WireModel[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.modelId !== "string" || entry.modelId.length === 0) continue;
    out.push({
      modelId: entry.modelId,
      ...(typeof entry.name === "string" ? { name: entry.name } : {}),
      ...(typeof entry.description === "string" ? { description: entry.description } : {}),
    });
  }
  return out;
};

const readCurrentModelId = (session: unknown): string | undefined => {
  if (!isRecord(session) || !isRecord(session.models)) return undefined;
  const current = session.models.currentModelId;
  return typeof current === "string" && current.length > 0 ? current : undefined;
};

/** Strips codex's `" (medium)"` suffix off an effort-variant display name so the base model keeps one clean label. */
const stripEffortSuffix = (name: string, effort: string): string => {
  const suffix = ` (${effort})`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
};

/**
 * Folds a `session/new` `models.availableModels` list into base models:
 * bracketed ids (`model[effort]`, codex) group by base id with the efforts
 * collected in adapter order; plain ids (claude) map 1:1 with no efforts.
 * `currentModelId` decides each grouped model's `defaultEffort` when it
 * matches; otherwise the first listed effort is the default.
 */
export const mapProviderCatalog = (
  provider: string,
  init: unknown,
  session: unknown,
): ChatProviderCatalogEntry => {
  const wire = readAvailableModels(session);
  const current = readCurrentModelId(session);
  const parsedCurrent = current !== undefined ? parseModelId(current) : undefined;

  interface Group {
    id: string;
    label: string;
    description?: string;
    efforts: string[];
  }
  const order: string[] = [];
  const groups = new Map<string, Group>();
  for (const model of wire) {
    const { model: base, effort } = parseModelId(model.modelId);
    let group = groups.get(base);
    if (group === undefined) {
      group = { id: base, label: base, efforts: [] };
      groups.set(base, group);
      order.push(base);
    }
    const rawLabel = model.name ?? model.modelId;
    const label = effort !== undefined ? stripEffortSuffix(rawLabel, effort) : rawLabel;
    // First variant's (stripped) name wins as the base label; a later plain
    // entry never downgrades an already-set human name.
    if (group.label === group.id && label !== group.id) group.label = label;
    if (group.label === group.id) group.label = label;
    if (model.description !== undefined && group.description === undefined) {
      group.description = model.description;
    }
    if (effort !== undefined && !group.efforts.includes(effort)) group.efforts.push(effort);
  }

  const models: ChatCatalogModel[] = order.map((base) => {
    const group = groups.get(base) as Group;
    const defaultEffort =
      parsedCurrent?.model === base && parsedCurrent.effort !== undefined && group.efforts.includes(parsedCurrent.effort)
        ? parsedCurrent.effort
        : group.efforts[0];
    return {
      id: group.id,
      label: group.label,
      ...(group.description !== undefined ? { description: group.description } : {}),
      efforts: group.efforts,
      ...(defaultEffort !== undefined ? { defaultEffort } : {}),
    };
  });

  return {
    provider,
    title: providerTitle(provider),
    models,
    ...(parsedCurrent !== undefined ? { currentModelId: parsedCurrent.model } : {}),
    ...(parsedCurrent?.effort !== undefined ? { currentEffort: parsedCurrent.effort } : {}),
    imageSupport: readImageCapability(init),
    probed: true,
  };
};

/** The honest degraded entry when a provider can't be probed: bare provider name, no models, no effort UI; images default-on (both shipped adapters support them) but flagged unprobed. */
export const fallbackCatalogEntry = (provider: string, note: string): ChatProviderCatalogEntry => ({
  provider,
  title: providerTitle(provider),
  models: [],
  imageSupport: true,
  probed: false,
  note,
});

// ---------------------------------------------------------------------------
// Image blocks for session/prompt
// ---------------------------------------------------------------------------

/** ~5MB of DECODED image bytes per image -- the ruled sane cap; oversized uploads are rejected honestly (HTTP 413-style error), never silently downscaled. */
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export interface ChatImageAttachment {
  /** Base64 payload (no data-url prefix). */
  readonly data: string;
  readonly mimeType: string;
  readonly name?: string;
}

/** Decoded byte size of a base64 payload, without decoding it. */
export const base64ByteSize = (data: string): number => {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
};

/** One image's admission check: supported mime type, plausible base64, inside the size cap. Returns an error string or undefined when fine. */
export const validateChatImage = (image: ChatImageAttachment): string | undefined => {
  if (!IMAGE_MIME_TYPES.has(image.mimeType)) {
    return `unsupported image type "${image.mimeType}" (supported: ${[...IMAGE_MIME_TYPES].join(", ")})`;
  }
  if (image.data.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
    return "image data must be non-empty base64";
  }
  const bytes = base64ByteSize(image.data);
  if (bytes > MAX_CHAT_IMAGE_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return `image${image.name !== undefined ? ` "${image.name}"` : ""} is ${mb}MB -- the limit is ${String(MAX_CHAT_IMAGE_BYTES / (1024 * 1024))}MB per image`;
  }
  return undefined;
};

/** An ACP `session/prompt` content block this codebase sends: text, or a base64 image (both adapters' accepted wire shape). */
export type ChatPromptBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

/** The prompt payload: text first (when non-empty), then each image as an ACP image content block. */
export const buildPromptBlocks = (
  text: string,
  images: ReadonlyArray<ChatImageAttachment> = [],
): ReadonlyArray<ChatPromptBlock> => {
  const blocks: ChatPromptBlock[] = [];
  if (text.length > 0) blocks.push({ type: "text", text });
  for (const image of images) {
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  return blocks;
};
