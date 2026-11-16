import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";

const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type ComposerContextMeterUsage = ContextWindowSnapshot | null;

/** Fork: the thread's context window as a ring in the composer; upstream keeps it in thread details. */
export function ComposerContextMeter({ usage }: { readonly usage: ComposerContextMeterUsage }) {
  if (!usage) return null;
  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const used =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const summary =
    used !== null
      ? `Context: ${used}% used`
      : `Context: ${formatContextWindowTokens(usage.usedTokens)} tokens used`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            role="img"
            aria-label={summary}
            className="flex size-7 shrink-0 items-center justify-center rounded-(--control-radius) outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={cn(
            "size-4 -rotate-90",
            // The same bands as the Context row in thread details.
            used !== null && used >= 90
              ? "text-error"
              : used !== null && used >= 80
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            fill="none"
            strokeWidth="3"
            className="stroke-muted-foreground/24"
          />
          {used ? (
            <circle
              cx="12"
              cy="12"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - used / 100)}
            />
          ) : null}
        </svg>
      </TooltipTrigger>
      <TooltipPopup>
        <div className="flex flex-col gap-0.5">
          <span className="text-foreground">{summary}</span>
          {maxTokens !== null ? (
            <span className="text-muted-foreground">
              {usage.usedTokens.toLocaleString("en-US")} of {maxTokens.toLocaleString("en-US")}{" "}
              tokens
            </span>
          ) : null}
          {threshold !== null && threshold > 0 ? (
            <span className="text-muted-foreground">
              {formatContextWindowCompactionMessage(threshold)}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
