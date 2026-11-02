import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { composerLimitWindows } from "./rateLimits";

const NOW = Date.parse("2026-11-02T12:00:00Z");

function window(
  kind: ServerProviderUsageWindow["kind"],
  id: string,
  resetsAt?: string,
): ServerProviderUsageWindow {
  return {
    id,
    kind,
    label: id,
    usedPercent: 40,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

function limits(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
  extra: Partial<ServerProviderUsageLimits> = {},
): ServerProviderUsageLimits {
  return { checkedAt: "2026-11-02T11:59:00Z", windows: [...windows], ...extra };
}

describe("composerLimitWindows", () => {
  it("picks the first session and weekly windows, ignoring model-scoped buckets", () => {
    const session = window("session", "five_hour", "2026-11-02T14:00:00Z");
    const weekly = window("weekly", "seven_day", "2026-11-06T00:00:00Z");
    const opus = window("weekly", "seven_day_opus", "2026-11-06T00:00:00Z");
    expect(composerLimitWindows(limits([session, weekly, opus]), NOW)).toEqual({
      fiveHour: session,
      weekly,
    });
  });

  it("hides a window whose reset has passed and keeps one with no reset time", () => {
    const expired = window("session", "five_hour", "2026-11-02T11:00:00Z");
    const open = window("weekly", "seven_day");
    expect(composerLimitWindows(limits([expired, open]), NOW)).toEqual({
      fiveHour: null,
      weekly: open,
    });
  });

  it("returns null when nothing live is reported", () => {
    expect(composerLimitWindows(undefined, NOW)).toBeNull();
    expect(composerLimitWindows(limits([window("monthly", "monthly")]), NOW)).toBeNull();
    expect(
      composerLimitWindows(
        limits([window("session", "five_hour")], {
          unavailable: { reason: "unsupported" },
        }),
        NOW,
      ),
    ).toBeNull();
  });
});
