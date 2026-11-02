import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";

export interface ComposerLimitWindows {
  readonly fiveHour: ServerProviderUsageWindow | null;
  readonly weekly: ServerProviderUsageWindow | null;
}

// The first session and weekly windows; model-scoped buckets stay on the Limits tab. A window
// whose reset has passed rolled over on the provider side, so its percent is dead data.
export function composerLimitWindows(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
): ComposerLimitWindows | null {
  if (!limits || limits.unavailable) return null;
  const live = (kind: ServerProviderUsageWindow["kind"]) => {
    const window = limits.windows.find((candidate) => candidate.kind === kind);
    if (!window) return null;
    const resetsAt = window.resetsAt === undefined ? Number.NaN : Date.parse(window.resetsAt);
    return resetsAt <= now ? null : window;
  };
  const fiveHour = live("session");
  const weekly = live("weekly");
  return fiveHour || weekly ? { fiveHour, weekly } : null;
}
