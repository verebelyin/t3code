import { Button } from "../ui/button";
import {
  formatRateLimitRemaining,
  formatRateLimitReset,
  isRateLimitWindowExpired,
  type RateLimitsSnapshot,
} from "~/lib/rateLimits";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatPercent(value: number): string {
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

/**
 * Green until 50%, amber to 90%, red above — same thresholds inline and in
 * the popover bars. Green is muted toward the secondary label tone: "fine" is
 * the resting state and should not glow like an alert.
 */
function windowColor(usedPercent: number): string {
  if (usedPercent > 90) {
    return "var(--color-error)";
  }
  if (usedPercent >= 50) {
    return "var(--color-warning)";
  }
  return "color-mix(in oklab, var(--color-success) 55%, var(--color-muted-foreground))";
}

/** Zero-padded so columns never shift as usage changes: "08%", "58%", "100%". */
function formatTerminalPercent(value: number): string {
  return `${String(Math.round(value)).padStart(2, "0")}%`;
}

function InlineWindow(props: {
  label: string;
  window: NonNullable<RateLimitsSnapshot["fiveHour"]>;
}) {
  const { label, window } = props;
  const remaining = formatRateLimitRemaining(window.resetsAt);
  return (
    <span>
      <span className="opacity-60">{label}</span>{" "}
      <span className="font-semibold" style={{ color: windowColor(window.usedPercent) }}>
        {formatTerminalPercent(window.usedPercent)}
      </span>
      {remaining ? <span className="text-secondary-label"> {remaining}</span> : null}
    </span>
  );
}

function RateLimitWindowRow(props: {
  label: string;
  window: NonNullable<RateLimitsSnapshot["fiveHour"]>;
}) {
  const { label, window } = props;
  const resetCopy = formatRateLimitReset(window.resetsAt);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
        <span className="text-secondary-label">{label}</span>
        <span className="font-medium tabular-nums text-secondary-label">
          {formatPercent(window.usedPercent)}
          {resetCopy ? <span className="font-normal"> · {resetCopy}</span> : null}
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(window.usedPercent)}
        aria-label={`${label} usage`}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
          style={{
            width: `${window.usedPercent}%`,
            backgroundColor: windowColor(window.usedPercent),
          }}
        />
      </div>
    </div>
  );
}

export function RateLimitMeter(props: { limits: RateLimitsSnapshot }) {
  const { limits } = props;
  // Expiry is checked at render, not in the memoized derive: a window whose
  // reset time has passed rolled over on the provider side, so its recorded
  // percent is dead data. Hide it (and the whole meter when nothing is live)
  // until the next session event brings a fresh snapshot.
  const now = new Date();
  const fiveHour =
    limits.fiveHour && !isRateLimitWindowExpired(limits.fiveHour, now) ? limits.fiveHour : null;
  const weekly =
    limits.weekly && !isRateLimitWindowExpired(limits.weekly, now) ? limits.weekly : null;
  if (!fiveHour && !weekly) {
    return null;
  }
  const normalizedPercentage = Math.max(
    0,
    Math.min(100, Math.max(fiveHour?.usedPercent ?? 0, weekly?.usedPercent ?? 0)),
  );

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <Button
            size="sm"
            variant="ghost-muted"
            className="h-7 gap-0 rounded-full px-2 font-mono text-[11px] tracking-tight tabular-nums hover:text-muted-foreground data-pressed:text-muted-foreground"
            aria-label={`Usage limits ${formatPercent(normalizedPercentage)} used`}
          >
            {fiveHour ? <InlineWindow label="5h" window={fiveHour} /> : null}
            {fiveHour && weekly ? (
              <span className="mx-1.5 text-secondary-label opacity-50">│</span>
            ) : null}
            {weekly ? <InlineWindow label="7d" window={weekly} /> : null}
          </Button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        viewportClassName="p-0"
        className="w-64 max-w-none text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2 p-[var(--floating-content-inset)]">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Usage Limits</div>
            {limits.planType ? (
              <div className="text-secondary-label text-[11px] capitalize">{limits.planType}</div>
            ) : null}
          </div>
          {fiveHour ? <RateLimitWindowRow label="5-hour limit" window={fiveHour} /> : null}
          {weekly ? <RateLimitWindowRow label="Weekly limit" window={weekly} /> : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
