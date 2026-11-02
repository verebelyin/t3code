import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { formatResetsIn, remainingPercent } from "@t3tools/shared/usageLimits";

import { useNowMinute } from "../../hooks/useNowMinute";
import { composerLimitWindows } from "../../lib/rateLimits";

// Green until 50% used, amber to 90%, red above. Green is muted: "fine" is the resting state.
function windowColor(usedPercent: number): string {
  if (usedPercent > 90) return "var(--color-error)";
  if (usedPercent >= 50) return "var(--color-warning)";
  return "color-mix(in oklab, var(--color-success) 55%, var(--color-muted-foreground))";
}

function InlineWindow(props: { label: string; window: ServerProviderUsageWindow; now: number }) {
  const used = 100 - remainingPercent(props.window);
  const resetsIn = formatResetsIn(props.window, props.now)?.replace(/^resets in /, "");
  return (
    <span>
      <span className="opacity-60">{props.label}</span>{" "}
      <span className="font-semibold" style={{ color: windowColor(used) }}>
        {String(used).padStart(2, "0")}%
      </span>
      {resetsIn ? <span className="text-secondary-label"> {resetsIn}</span> : null}
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
    <span className="inline-flex h-7 items-center px-2 font-mono text-2xs tracking-tight tabular-nums text-muted-foreground">
      {fiveHour ? <InlineWindow label="5h" window={fiveHour} now={now} /> : null}
      {fiveHour && weekly ? (
        <span className="mx-1.5 text-secondary-label opacity-50">│</span>
      ) : null}
      {weekly ? <InlineWindow label="7d" window={weekly} now={now} /> : null}
    </span>
  );
}
