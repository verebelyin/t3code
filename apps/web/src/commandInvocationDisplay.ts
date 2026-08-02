import type { WorkLogEntry } from "./session-logic";

/**
 * View model for the expanded body of a command tool call.
 *
 * Splitting the flat "command + output" blob into named parts is what lets the
 * row render a terminal-shaped block — a prompt line and a scrollable transcript
 * — instead of one undifferentiated `<pre>`.
 *
 * @module commandInvocationDisplay
 */
export interface CommandInvocationView {
  /** The command as typed, preferring the raw form over the collapsed preview. */
  readonly command: string;
  /** Captured stdout/stderr, already stripped of any exit-code suffix. */
  readonly output: string | null;
  /** True when the adapter capped `output`, so the row can say so. */
  readonly outputTruncated: boolean;
  readonly exitCode: number | undefined;
  /** True when the run reported a non-zero exit. */
  readonly failed: boolean;
}

/**
 * Build the command view for a work entry, or `null` when the entry is not a
 * command run — in which case the caller keeps its existing plain-text body.
 *
 * `rawCommand` wins over `command`: the latter is collapsed to a single line for
 * the row heading, which would silently reformat a multi-line heredoc or a
 * `&&`-chained script in the one place the user opened the row to read it.
 */
export function buildCommandInvocationView(
  workEntry: Pick<
    WorkLogEntry,
    "itemType" | "command" | "rawCommand" | "detail" | "exitCode" | "toolInvocation"
  >,
): CommandInvocationView | null {
  const isCommandRow =
    workEntry.itemType === "command_execution" ||
    workEntry.toolInvocation?.targetKind === "command";
  if (!isCommandRow) {
    return null;
  }

  const command = (workEntry.rawCommand ?? workEntry.command ?? "").trim();
  if (command.length === 0) {
    return null;
  }

  // `output` is the adapter's captured stdout/stderr and is always the truth.
  // `detail` is the fallback for providers that never populate it, and there it
  // means different things — the command echo for some, the output for others —
  // so it is only trusted when it does not merely restate the command.
  const invocation = workEntry.toolInvocation;
  const shipped = invocation?.output?.trim();
  const detail = workEntry.detail?.trim();
  const fallback = detail && !restatesCommand(detail, command) ? detail : undefined;
  const output = shipped && shipped.length > 0 ? shipped : fallback;

  const exitCode = workEntry.exitCode ?? invocation?.exitCode;
  return {
    command,
    output: output && output.length > 0 ? output : null,
    outputTruncated: invocation?.outputTruncated === true,
    exitCode,
    failed: exitCode !== undefined && exitCode !== 0,
  };
}

/**
 * True when a detail string is just the command again, in any of the shapes
 * adapters produce (`ls -la`, `Bash: ls -la`, `bash -lc "ls -la"`).
 *
 * Printing that under a "$ ls -la" prompt line reads as output that never
 * happened, which is worse than showing nothing.
 */
function restatesCommand(detail: string, command: string): boolean {
  const normalize = (value: string) => value.replaceAll(/\s+/g, " ").trim().toLowerCase();
  const normalizedDetail = normalize(detail);
  const normalizedCommand = normalize(command);
  if (normalizedDetail === normalizedCommand) {
    return true;
  }
  // `Bash: <command>` and friends — a short prefix, then the command verbatim.
  const suffix = normalizedDetail.slice(-normalizedCommand.length);
  return normalizedDetail.length <= normalizedCommand.length + 16 && suffix === normalizedCommand;
}
