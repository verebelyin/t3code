import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { remainingPercent, resetCountdown } from "@t3tools/shared/usageLimits";
import { formatDuration, formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { useMessages } from "gt-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { composerLimitWindows } from "../../lib/rateLimits";
import { cn } from "../../lib/utils";

function InlineWindow(props: { label: string; window: ServerProviderUsageWindow; now: number }) {
  const m = useMessages();
  const used = 100 - remainingPercent(props.window);
  const countdown = resetCountdown(props.window, props.now);
  const resetsIn =
    countdown?.kind === "in"
      ? formatDuration(countdown.ms, m)
      : formatResetsIn(props.window, props.now, m);
  return (
    // Trimmed to the cap box like ComposerControl labels, so both sit on one optical line.
    <span className="[text-box:trim-both_cap_alphabetic]">
      {props.label}{" "}
      <span
        className={cn(
          "font-medium",
          used > 90
            ? "text-error-foreground"
            : used >= 50
              ? "text-warning-foreground"
              : "text-success-foreground",
        )}
      >
        {used}%
      </span>
      {resetsIn ? ` ${resetsIn}` : null}
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
    // The type scale of a ComposerControl, so the meter reads as part of the same row.
    <span className="inline-flex h-7 shrink-0 items-center gap-2 px-2 text-base whitespace-nowrap tabular-nums text-muted-foreground sm:text-sm">
      {fiveHour ? <InlineWindow label="5h" window={fiveHour} now={now} /> : null}
      {fiveHour && weekly ? <span aria-hidden="true" className="h-3 w-px bg-border" /> : null}
      {weekly ? <InlineWindow label="7d" window={weekly} now={now} /> : null}
    </span>
  );
}
