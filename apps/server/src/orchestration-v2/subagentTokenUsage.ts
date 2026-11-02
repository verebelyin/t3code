import type {
  OrchestrationV2ProviderThread,
  OrchestrationV2ProviderTurn,
  OrchestrationV2RunAttempt,
  ProviderThreadId,
  RunId,
  SubagentTokenUsage,
} from "@t3tools/contracts";

/**
 * Fork: tokens one delegated child run spent. Sums the main-agent usage of
 * every provider turn in the run's attempts. Providers without per-turn usage
 * (ACP, e.g. Command Code) fall back to the provider thread's context reading,
 * marked approximate since it measures context size rather than spend.
 */
export function rollUpSubagentTokenUsage(input: {
  readonly runId: RunId;
  readonly providerThreadId: ProviderThreadId | null;
  readonly attempts: ReadonlyArray<Pick<OrchestrationV2RunAttempt, "id" | "runId">>;
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "runAttemptId" | "turnTokenUsage">
  >;
  readonly providerThreads: ReadonlyArray<
    Pick<OrchestrationV2ProviderThread, "id" | "contextUsage">
  >;
}): SubagentTokenUsage | undefined {
  const attemptIds = new Set(
    input.attempts.filter((attempt) => attempt.runId === input.runId).map((attempt) => attempt.id),
  );
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningTokens = 0;
  let counted = 0;
  let partial = false;
  for (const turn of input.providerTurns) {
    const usage = turn.turnTokenUsage;
    if (turn.runAttemptId === null || !attemptIds.has(turn.runAttemptId) || usage === undefined) {
      continue;
    }
    if (usage.inputTokens === undefined && usage.outputTokens === undefined) continue;
    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
    cachedInputTokens += usage.cachedInputTokens ?? 0;
    reasoningTokens += usage.reasoningTokens ?? 0;
    partial ||= usage.usageStatus !== "complete";
    counted += 1;
  }
  if (counted > 0) {
    return {
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      ...(cachedInputTokens > 0 ? { cachedInputTokens } : {}),
      ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
      approximate: partial,
    };
  }
  const context = input.providerThreads.find(
    (thread) => thread.id === input.providerThreadId,
  )?.contextUsage;
  if (context === undefined || context === null) return undefined;
  return { totalTokens: context.totalProcessedTokens ?? context.usedTokens, approximate: true };
}

/** Fork: Claude's per-task usage from `task_progress` / `task_notification`. */
export function claudeTaskTokenUsage(
  usage: { readonly total_tokens: number } | undefined,
): SubagentTokenUsage | undefined {
  if (usage === undefined || !Number.isInteger(usage.total_tokens) || usage.total_tokens < 0) {
    return undefined;
  }
  return { totalTokens: usage.total_tokens, approximate: false };
}

/** Spreads `usage` only when present, for records under exactOptionalPropertyTypes. */
export function optionalUsage(usage: SubagentTokenUsage | undefined) {
  return usage === undefined ? {} : { usage };
}
