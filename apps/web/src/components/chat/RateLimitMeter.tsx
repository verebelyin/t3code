import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";

import { useNowMinute } from "../../hooks/useNowMinute";
import { composerLimitWindows } from "../../lib/rateLimits";
import { cn } from "../../lib/utils";

function InlineWindow(props: { label: string; window: ServerProviderUsageWindow; now: number }) {
  const used = 100 - remainingPercent(props.window);
  const resetsIn = formatResetsIn(props.window, props.now)?.replace(/^resets in /, "");
  return (
    <span className="inline-flex items-baseline gap-1">
      <span>{props.label}</span>
      <span
        className={cn(
          "font-medium",
          // The same bands as the limit rows in thread details: 20% left warns, 10% is an error.
          used >= 90
            ? "text-error-foreground"
            : used >= 80
              ? "text-warning-foreground"
              : "text-foreground/80",
        )}
      >
        {used}%
      </span>
      {resetsIn ? <span>{resetsIn}</span> : null}
    </span>
  );
}

export function RateLimitMeter(props: { limits: ServerProviderUsageLimits | undefined }) {
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}:00Z`);
  const windows = composerLimitWindows(props.limits, now);
  if (!windows) return null;
  const { fiveHour, weekly } = windows;
  return (
    <span className="inline-flex h-7 shrink-0 items-center gap-2 px-2 text-xs tabular-nums text-muted-foreground">
      {fiveHour ? <InlineWindow label="5h" window={fiveHour} now={now} /> : null}
      {fiveHour && weekly ? <span aria-hidden="true" className="h-3 w-px bg-border" /> : null}
      {weekly ? <InlineWindow label="7d" window={weekly} now={now} /> : null}
    </span>
  );
}
