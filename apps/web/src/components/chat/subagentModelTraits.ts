import type {
  OrchestrationV2Subagent,
  OrchestrationV2ThreadShell,
  ProviderInstanceId,
  ServerProvider,
  SubagentTokenUsage,
} from "@t3tools/contracts";
import { isReasoningSelect } from "@t3tools/client-runtime/model-traits";
import { resolveSubagentMetadata } from "@t3tools/client-runtime/state/subagent-display";
import {
  getModelSelectionStringOptionValue,
  getProviderOptionCurrentValue,
  resolveSelectableModel,
} from "@t3tools/shared/model";

import { formatContextWindowTokens } from "../../lib/contextWindow";

// Fork: the model and effort a subagent runs with. An unset effort is the model's default.
export function resolveSubagentModelTraits(input: {
  readonly model: string | null;
  readonly providerInstanceId: ProviderInstanceId;
  readonly origin: OrchestrationV2Subagent["origin"];
  readonly modelSelection?: OrchestrationV2Subagent["modelSelection"] | undefined;
  readonly provider?: ServerProvider | undefined;
  readonly childThread?: Pick<OrchestrationV2ThreadShell, "modelSelection"> | undefined;
}) {
  const { provider } = input;
  const resolve = (model: string | null | undefined) =>
    (provider && resolveSelectableModel(provider.driver, model, provider.models)) ?? model?.trim();
  const recorded =
    input.modelSelection ??
    (input.origin === "app_owned" ? input.childThread?.modelSelection : undefined);
  const model = resolve(input.model ?? recorded?.model);
  const selection =
    recorded?.instanceId === input.providerInstanceId && resolve(recorded.model) === model
      ? recorded
      : undefined;
  const { modelLabel } = resolveSubagentMetadata({ model: model ?? null, provider });
  const descriptor = provider?.models
    .find((candidate) => candidate.slug === model)
    ?.capabilities?.optionDescriptors?.find(isReasoningSelect);
  const value =
    descriptor &&
    (getModelSelectionStringOptionValue(selection, descriptor.id) ??
      getProviderOptionCurrentValue(descriptor, selection));
  const effort =
    typeof value === "string"
      ? (descriptor?.options.find((option) => option.id === value)?.label ?? value)
      : undefined;
  return { modelLabel, effort };
}

/** Fork: "42k tok", or "~42k tok" when only a context-size reading exists. */
export function formatSubagentTokens(usage: SubagentTokenUsage): string {
  return `${usage.approximate ? "~" : ""}${formatContextWindowTokens(usage.totalTokens)} tok`;
}

/** Fork: "in 1.5k · out 300 · cached 600", or null when only a total is known. */
export function formatSubagentTokenBreakdown(usage: SubagentTokenUsage): string | null {
  const parts = (
    [
      ["in", usage.inputTokens],
      ["out", usage.outputTokens],
      ["cached", usage.cachedInputTokens],
    ] as const
  )
    .filter(([, count]) => count !== undefined)
    .map(([label, count]) => `${label} ${formatContextWindowTokens(count ?? null)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Fork: the group header's model line: one shared "model · effort", or "N models". */
export function summarizeSubagentModels(
  entries: ReadonlyArray<Parameters<typeof resolveSubagentModelTraits>[0]>,
): string | null {
  const labels = new Set(
    entries
      .filter((entry) => entry.model !== null || entry.modelSelection !== undefined)
      .map((entry) => {
        const { modelLabel, effort } = resolveSubagentModelTraits(entry);
        return effort ? `${modelLabel} · ${effort}` : modelLabel;
      }),
  );
  if (labels.size === 0) return null;
  return labels.size === 1 ? [...labels][0]! : `${labels.size} models`;
}
