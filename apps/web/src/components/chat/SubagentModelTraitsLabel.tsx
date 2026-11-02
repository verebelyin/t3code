import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  OrchestrationV2Subagent,
  ProviderInstanceId,
  SubagentTokenUsage,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { useThreadShell } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import {
  formatSubagentTokenBreakdown,
  formatSubagentTokens,
  resolveSubagentModelTraits,
} from "./subagentModelTraits";

/**
 * Fork: "model · effort" beside a subagent's title in the parent timeline.
 * Reads the child thread's selection only for app-owned tasks recorded
 * before tasks kept their own selection.
 */
export function SubagentModelTraitsLabel(props: {
  readonly environmentId: EnvironmentId;
  readonly childThreadId: ThreadId | null;
  readonly model: string | null;
  readonly modelSelection: OrchestrationV2Subagent["modelSelection"];
  readonly origin: OrchestrationV2Subagent["origin"];
  readonly providerInstanceId: ProviderInstanceId;
}) {
  const provider = useAtomValue(
    serverEnvironment.providersValueAtom(props.environmentId),
    (providers) =>
      providers?.find((candidate) => candidate.instanceId === props.providerInstanceId),
  );
  const needsChild =
    props.modelSelection === undefined && props.origin === "app_owned" && props.childThreadId;
  const child = useThreadShell(
    needsChild ? scopeThreadRef(props.environmentId, props.childThreadId!) : null,
  )?.source;
  if (props.model === null && props.modelSelection === undefined) return null;
  const { modelLabel, effort } = resolveSubagentModelTraits({
    ...props,
    provider,
    childThread: child,
  });
  return (
    <span className="min-w-0 truncate text-3xs text-muted-foreground">
      {effort ? `${modelLabel} · ${effort}` : modelLabel}
    </span>
  );
}

export interface SubagentTokenUsageLineProps {
  readonly usage: SubagentTokenUsage | undefined;
}

/** Fork: tokens a subagent spent, in its hover card. */
export function SubagentTokenUsageLine({ usage }: SubagentTokenUsageLineProps) {
  if (!usage) return null;
  const breakdown = formatSubagentTokenBreakdown(usage);
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 text-foreground/75">
      <span className="tabular-nums">{formatSubagentTokens(usage)}</span>
      {breakdown ? <span className="min-w-0 truncate tabular-nums">{breakdown}</span> : null}
    </div>
  );
}
