/**
 * The compose bar's grouped model picker (ruled 2026-07-23): ONE dropdown,
 * models grouped under provider headers ("Claude Code" / "Codex" optgroups)
 * -- choosing a model implies the provider, so this REPLACES the old
 * provider picker in both the ChatTab and the new-skill launcher. Beside
 * it, an effort selector that renders ONLY when the selected model's
 * provider actually supports effort levels (codex reasoning effort); no
 * fakery for providers without the door (claude-code).
 *
 * Degradation ladder (server truth, never invented): a probed provider
 * lists its real models; an unprobed provider (or a serverless shell)
 * degrades to one provider-name option with no model/effort choice.
 */
import type { ChatCatalogModel, ChatProviderCatalog } from "./chatApi.ts";

export interface ModelSelection {
  readonly provider: string;
  /** BASE model id; undefined -> the provider's default (no model choice available or made). */
  readonly model?: string;
  readonly effort?: string;
}

/** Option-value encoding: `provider::model` (model empty for provider-only rows). Neither provider ids nor model ids contain `::`. */
const SEP = "::";
const encode = (provider: string, model: string | undefined): string => `${provider}${SEP}${model ?? ""}`;
const decode = (value: string): { readonly provider: string; readonly model?: string } => {
  const index = value.indexOf(SEP);
  if (index === -1) return { provider: value };
  const model = value.slice(index + SEP.length);
  return { provider: value.slice(0, index), ...(model.length > 0 ? { model } : {}) };
};

const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** The catalog entry / model the selection points at (either may be undefined on the degraded ladder). */
export const selectedCatalogModel = (
  catalog: ReadonlyArray<ChatProviderCatalog> | null,
  selection: ModelSelection,
): { readonly entry?: ChatProviderCatalog; readonly model?: ChatCatalogModel } => {
  const entry = catalog?.find((candidate) => candidate.provider === selection.provider);
  const model =
    selection.model !== undefined
      ? entry?.models.find((candidate) => candidate.id === selection.model)
      : undefined;
  return { ...(entry !== undefined ? { entry } : {}), ...(model !== undefined ? { model } : {}) };
};

/** Whether the selection's provider takes image attachments (unknown providers default true -- both shipped adapters support images; the server's probe flag is the authority when present). */
export const selectionSupportsImages = (
  catalog: ReadonlyArray<ChatProviderCatalog> | null,
  provider: string,
): boolean => {
  const entry = catalog?.find((candidate) => candidate.provider === provider);
  return entry === undefined ? true : entry.imageSupport;
};

/** The default selection for a catalog: the first provider's current (or first) model. Falls back to the first provider id when nothing is probed. */
export const defaultSelection = (
  catalog: ReadonlyArray<ChatProviderCatalog> | null,
  providers: ReadonlyArray<string>,
): ModelSelection | undefined => {
  const entry = catalog?.find((candidate) => candidate.models.length > 0) ?? catalog?.[0];
  if (entry !== undefined) {
    const model =
      entry.models.find((candidate) => candidate.id === entry.currentModelId) ?? entry.models[0];
    return {
      provider: entry.provider,
      ...(model !== undefined ? { model: model.id } : {}),
      ...(model?.defaultEffort !== undefined ? { effort: model.defaultEffort } : {}),
    };
  }
  const provider = providers[0];
  return provider !== undefined ? { provider } : undefined;
};

const SELECT_CLASS =
  "cursor-pointer truncate bg-transparent text-xs text-ink-muted outline-none hover:text-ink disabled:cursor-default disabled:opacity-60";

export function ModelPicker({
  catalog,
  providers,
  selection,
  onChange,
  disabled = false,
  lockProvider,
}: {
  /** `null` -> catalog unavailable (serverless / endpoint absent): degrade to bare provider names. */
  readonly catalog: ReadonlyArray<ChatProviderCatalog> | null;
  /** Fallback provider ids when the catalog is absent. */
  readonly providers: ReadonlyArray<string>;
  readonly selection: ModelSelection;
  readonly onChange: (selection: ModelSelection) => void;
  readonly disabled?: boolean;
  /** An active session's provider: models of OTHER providers disable (switching provider mid-session means a new session, not a model change). */
  readonly lockProvider?: string;
}) {
  const entries: ReadonlyArray<ChatProviderCatalog> =
    catalog !== null && catalog.length > 0
      ? catalog
      : providers.map((provider) => ({
          provider,
          title: provider,
          models: [],
          imageSupport: true,
          probed: false,
        }));

  const { model: selectedModel } = selectedCatalogModel(catalog, selection);
  const efforts = selectedModel?.efforts ?? [];
  const effortValue = selection.effort ?? selectedModel?.defaultEffort ?? efforts[0] ?? "";

  const handleModelChange = (value: string) => {
    const { provider, model } = decode(value);
    const next = catalog?.find((candidate) => candidate.provider === provider);
    const nextModel = model !== undefined ? next?.models.find((candidate) => candidate.id === model) : undefined;
    onChange({
      provider,
      ...(model !== undefined ? { model } : {}),
      ...(nextModel?.defaultEffort !== undefined ? { effort: nextModel.defaultEffort } : {}),
    });
  };

  return (
    <>
      {efforts.length > 0 && (
        <select
          className={`max-w-[28%] ${SELECT_CLASS}`}
          value={effortValue}
          disabled={disabled}
          title="Reasoning effort for this model"
          onChange={(event) => onChange({ ...selection, effort: event.target.value })}
        >
          {efforts.map((effort) => (
            <option key={effort} value={effort}>
              {capitalize(effort)}
            </option>
          ))}
        </select>
      )}
      <select
        className={`max-w-[45%] ${SELECT_CLASS}`}
        value={encode(selection.provider, selection.model)}
        disabled={disabled}
        title="Model for the session (grouped by agent; picking a model picks its agent)"
        onChange={(event) => handleModelChange(event.target.value)}
      >
        {entries.map((entry) =>
          entry.models.length > 0 ? (
            <optgroup key={entry.provider} label={entry.title}>
              {entry.models.map((model) => (
                <option
                  key={model.id}
                  value={encode(entry.provider, model.id)}
                  disabled={lockProvider !== undefined && entry.provider !== lockProvider}
                  title={model.description}
                >
                  {model.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option
              key={entry.provider}
              value={encode(entry.provider, undefined)}
              disabled={lockProvider !== undefined && entry.provider !== lockProvider}
              title={entry.note !== undefined ? `${entry.title}: ${entry.note}` : entry.title}
            >
              {entry.title}
            </option>
          ),
        )}
      </select>
    </>
  );
}
