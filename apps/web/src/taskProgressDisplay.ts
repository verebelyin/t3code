import type { TaskProgressMeta } from "./session-logic";

/**
 * Compact summary of what a running subagent has done, for the row that would
 * otherwise read only "Running <step>".
 *
 * Ordered by what a reader scanning the log actually wants: what it is doing
 * now, how much it has done, how long that has taken, what it cost.
 *
 * @module taskProgressDisplay
 */

/** `139792` -> `2m 20s`. Sub-minute durations keep one decimal under 10s. */
export function formatTaskDuration(durationMs: number): string {
  const totalSeconds = durationMs / 1_000;
  if (totalSeconds < 10) {
    // `0.4s` reads as progress; `0s` reads as nothing happening.
    return `${Math.round(totalSeconds * 10) / 10}s`;
  }
  if (totalSeconds < 60) {
    return `${Math.round(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  // 59.6s rounds to 60 — carry rather than render "1m 60s".
  if (seconds === 60) {
    return `${minutes + 1}m`;
  }
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** `80339` -> `80.3k`. Token counts are scale indicators, not exact figures. */
export function formatTaskTokens(totalTokens: number): string {
  if (totalTokens < 1_000) {
    return `${totalTokens}`;
  }
  if (totalTokens < 1_000_000) {
    const thousands = totalTokens / 1_000;
    return `${thousands < 10 ? Math.round(thousands * 10) / 10 : Math.round(thousands)}k`;
  }
  return `${Math.round((totalTokens / 1_000_000) * 10) / 10}M`;
}

/**
 * Build the ordered segments of the meta line, or `null` when there is nothing
 * worth saying — the caller then renders the row exactly as it did before.
 */
export function formatTaskProgressMeta(meta: TaskProgressMeta | undefined): string[] | null {
  if (!meta) {
    return null;
  }
  const parts: string[] = [];
  if (meta.lastToolName) {
    parts.push(meta.lastToolName);
  }
  if (meta.toolUses !== undefined) {
    parts.push(`${meta.toolUses} ${meta.toolUses === 1 ? "tool" : "tools"}`);
  }
  if (meta.durationMs !== undefined) {
    parts.push(formatTaskDuration(meta.durationMs));
  }
  if (meta.totalTokens !== undefined) {
    parts.push(`${formatTaskTokens(meta.totalTokens)} tokens`);
  }
  return parts.length > 0 ? parts : null;
}
