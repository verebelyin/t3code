import type { OrchestrationThreadActivity } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type RateLimitWindowSnapshot = {
  readonly usedPercent: number;
  readonly resetsAt: string | null;
};

export type RateLimitsSnapshot = {
  readonly provider: string;
  readonly fiveHour: RateLimitWindowSnapshot | null;
  readonly weekly: RateLimitWindowSnapshot | null;
  readonly planType: string | null;
  /** The higher used-% of the two windows, the one that binds first. */
  readonly mostConstrainedPercent: number;
  readonly updatedAt: string;
};

function readWindow(value: unknown): RateLimitWindowSnapshot | null {
  const window = asRecord(value);
  const usedPercent = asFiniteNumber(window?.usedPercent);
  if (usedPercent === null) {
    return null;
  }
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: asNonEmptyString(window?.resetsAt),
  };
}

export function deriveLatestRateLimitsSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): RateLimitsSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || activity.kind !== "account-rate-limits.updated") {
      continue;
    }

    const payload = asRecord(activity.payload);
    const provider = asNonEmptyString(payload?.provider);
    const fiveHour = readWindow(payload?.fiveHour);
    const weekly = readWindow(payload?.weekly);
    if (!provider || (!fiveHour && !weekly)) {
      continue;
    }

    return {
      provider,
      fiveHour,
      weekly,
      planType: asNonEmptyString(payload?.planType),
      mostConstrainedPercent: Math.max(fiveHour?.usedPercent ?? 0, weekly?.usedPercent ?? 0),
      updatedAt: activity.createdAt,
    };
  }

  return null;
}

/**
 * A window whose reset time has passed is dead data: the provider window has
 * rolled over and true usage is unknown (near zero) until the next session
 * event. Showing the old percent would be false information.
 */
export function isRateLimitWindowExpired(
  window: RateLimitWindowSnapshot,
  now: Date = new Date(),
): boolean {
  if (!window.resetsAt) {
    return false;
  }
  const reset = new Date(window.resetsAt);
  return !Number.isNaN(reset.getTime()) && reset.getTime() <= now.getTime();
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Compact time-until-reset for the inline meter: "52m", "3h12m", "4d7h".
 * Static per render — no countdown timers. Past or invalid → null.
 */
export function formatRateLimitRemaining(
  resetsAt: string | null,
  now: Date = new Date(),
): string | null {
  if (!resetsAt) {
    return null;
  }
  const reset = new Date(resetsAt);
  const deltaMs = reset.getTime() - now.getTime();
  if (Number.isNaN(reset.getTime()) || deltaMs <= 0) {
    return null;
  }
  if (deltaMs < HOUR_MS) {
    return `${Math.max(1, Math.round(deltaMs / MINUTE_MS))}m`;
  }
  if (deltaMs < DAY_MS) {
    const hours = Math.floor(deltaMs / HOUR_MS);
    const minutes = Math.round((deltaMs - hours * HOUR_MS) / MINUTE_MS);
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(deltaMs / DAY_MS);
  const hours = Math.round((deltaMs - days * DAY_MS) / HOUR_MS);
  return hours > 0 ? `${days}d${hours}h` : `${days}d`;
}

/**
 * Static reset copy computed on render — deliberately no countdown, so the
 * meter never repaints on its own. Past or invalid timestamps return null.
 */
export function formatRateLimitReset(
  resetsAt: string | null,
  now: Date = new Date(),
): string | null {
  if (!resetsAt) {
    return null;
  }
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime()) || reset.getTime() <= now.getTime()) {
    return null;
  }
  if (reset.toDateString() === now.toDateString()) {
    return `Resets ${reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  if (reset.getTime() - now.getTime() < 7 * DAY_MS) {
    return `Resets ${reset.toLocaleDateString([], { weekday: "long" })}`;
  }
  return `Resets ${reset.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}
