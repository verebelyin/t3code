import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveLatestRateLimitsSnapshot,
  formatRateLimitRemaining,
  formatRateLimitReset,
  isRateLimitWindowExpired,
} from "./rateLimits";

function makeActivity(
  id: string,
  kind: string,
  payload: unknown,
  createdAt = "2026-03-23T00:00:00.000Z",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt,
  };
}

describe("deriveLatestRateLimitsSnapshot", () => {
  it("derives the latest resolvable snapshot by walking backwards", () => {
    const snapshot = deriveLatestRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        provider: "claude",
        fiveHour: { usedPercent: 10 },
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity(
        "activity-3",
        "account-rate-limits.updated",
        {
          provider: "claude",
          planType: "max_20x",
          fiveHour: { usedPercent: 42, resetsAt: "2026-03-23T05:00:00.000Z" },
          weekly: { usedPercent: 71, resetsAt: "2026-03-28T05:00:00.000Z" },
        },
        "2026-03-23T04:00:00.000Z",
      ),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.provider).toBe("claude");
    expect(snapshot?.planType).toBe("max_20x");
    expect(snapshot?.fiveHour).toEqual({
      usedPercent: 42,
      resetsAt: "2026-03-23T05:00:00.000Z",
    });
    expect(snapshot?.weekly).toEqual({
      usedPercent: 71,
      resetsAt: "2026-03-28T05:00:00.000Z",
    });
    expect(snapshot?.updatedAt).toBe("2026-03-23T04:00:00.000Z");
  });

  it("reports the most constrained window", () => {
    const snapshot = deriveLatestRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        provider: "claude",
        fiveHour: { usedPercent: 42 },
        weekly: { usedPercent: 71 },
      }),
    ]);

    expect(snapshot?.mostConstrainedPercent).toBe(71);
  });

  it("treats a missing window as zero for the most constrained percent", () => {
    const snapshot = deriveLatestRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        provider: "codex",
        weekly: { usedPercent: 12 },
      }),
    ]);

    expect(snapshot?.fiveHour).toBeNull();
    expect(snapshot?.weekly).toEqual({ usedPercent: 12, resetsAt: null });
    expect(snapshot?.mostConstrainedPercent).toBe(12);
    expect(snapshot?.planType).toBeNull();
  });

  it("clamps used percentages into 0-100", () => {
    const snapshot = deriveLatestRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        provider: "claude",
        fiveHour: { usedPercent: 137 },
        weekly: { usedPercent: -8 },
      }),
    ]);

    expect(snapshot?.fiveHour?.usedPercent).toBe(100);
    expect(snapshot?.weekly?.usedPercent).toBe(0);
    expect(snapshot?.mostConstrainedPercent).toBe(100);
  });

  it("keeps walking past malformed rows", () => {
    const snapshot = deriveLatestRateLimitsSnapshot([
      makeActivity("activity-1", "account-rate-limits.updated", {
        provider: "claude",
        fiveHour: { usedPercent: 33 },
      }),
      // No finite usedPercent on either window.
      makeActivity("activity-2", "account-rate-limits.updated", {
        provider: "claude",
        fiveHour: { usedPercent: Number.NaN },
        weekly: {},
      }),
      // Missing provider.
      makeActivity("activity-3", "account-rate-limits.updated", {
        fiveHour: { usedPercent: 99 },
      }),
      // Payload is not an object at all.
      makeActivity("activity-4", "account-rate-limits.updated", "nope"),
    ]);

    expect(snapshot?.fiveHour?.usedPercent).toBe(33);
    expect(snapshot?.updatedAt).toBe("2026-03-23T00:00:00.000Z");
  });

  it("returns null when no activity resolves", () => {
    expect(deriveLatestRateLimitsSnapshot([])).toBeNull();
    expect(
      deriveLatestRateLimitsSnapshot([
        makeActivity("activity-1", "tool.started", {}),
        makeActivity("activity-2", "account-rate-limits.updated", {}),
      ]),
    ).toBeNull();
  });
});

describe("formatRateLimitReset", () => {
  // Local-time construction so the assertions do not depend on the runner's
  // timezone; the formatting assertions mirror the same toLocale* calls.
  const now = new Date(2026, 7, 18, 12, 0, 0);

  it("returns null without a usable timestamp", () => {
    expect(formatRateLimitReset(null, now)).toBeNull();
    expect(formatRateLimitReset("not-a-date", now)).toBeNull();
  });

  it("returns null for timestamps already in the past", () => {
    const past = new Date(2026, 7, 18, 11, 0, 0);
    expect(formatRateLimitReset(past.toISOString(), now)).toBeNull();
    expect(formatRateLimitReset(now.toISOString(), now)).toBeNull();
  });

  it("formats a same-day reset as a time", () => {
    const reset = new Date(2026, 7, 18, 15, 0, 0);
    expect(formatRateLimitReset(reset.toISOString(), now)).toBe(
      `Resets ${reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    );
  });

  it("formats a reset within the week as a weekday", () => {
    const reset = new Date(2026, 7, 21, 9, 0, 0);
    expect(formatRateLimitReset(reset.toISOString(), now)).toBe(
      `Resets ${reset.toLocaleDateString([], { weekday: "long" })}`,
    );
  });

  it("formats a further-out reset as a short date", () => {
    const reset = new Date(2026, 7, 28, 9, 0, 0);
    expect(formatRateLimitReset(reset.toISOString(), now)).toBe(
      `Resets ${reset.toLocaleDateString([], { month: "short", day: "numeric" })}`,
    );
  });
});

describe("formatRateLimitRemaining", () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const at = (deltaMs: number) => new Date(now.getTime() + deltaMs).toISOString();

  it("returns null without a usable timestamp", () => {
    expect(formatRateLimitRemaining(null, now)).toBeNull();
    expect(formatRateLimitRemaining("not-a-date", now)).toBeNull();
    expect(formatRateLimitRemaining(at(-60_000), now)).toBeNull();
    expect(formatRateLimitRemaining(now.toISOString(), now)).toBeNull();
  });

  it("formats sub-hour deltas as minutes", () => {
    expect(formatRateLimitRemaining(at(52 * 60_000), now)).toBe("52m");
    expect(formatRateLimitRemaining(at(10_000), now)).toBe("1m");
  });

  it("formats sub-day deltas as hours and minutes", () => {
    expect(formatRateLimitRemaining(at((3 * 60 + 12) * 60_000), now)).toBe("3h12m");
    expect(formatRateLimitRemaining(at(4 * 60 * 60_000), now)).toBe("4h");
  });

  it("formats longer deltas as days and hours", () => {
    expect(formatRateLimitRemaining(at((4 * 24 + 7) * 60 * 60_000), now)).toBe("4d7h");
    expect(formatRateLimitRemaining(at(2 * 24 * 60 * 60_000), now)).toBe("2d");
  });
});

describe("isRateLimitWindowExpired", () => {
  const now = new Date(2026, 7, 18, 12, 0, 0);
  const at = (deltaMs: number) => new Date(now.getTime() + deltaMs).toISOString();

  it("marks windows whose reset time has passed as expired", () => {
    expect(isRateLimitWindowExpired({ usedPercent: 61, resetsAt: at(-60_000) }, now)).toBe(true);
    expect(isRateLimitWindowExpired({ usedPercent: 61, resetsAt: now.toISOString() }, now)).toBe(
      true,
    );
  });

  it("keeps windows with a future reset or no usable timestamp", () => {
    expect(isRateLimitWindowExpired({ usedPercent: 61, resetsAt: at(60_000) }, now)).toBe(false);
    expect(isRateLimitWindowExpired({ usedPercent: 61, resetsAt: null }, now)).toBe(false);
    expect(isRateLimitWindowExpired({ usedPercent: 61, resetsAt: "not-a-date" }, now)).toBe(false);
  });
});
