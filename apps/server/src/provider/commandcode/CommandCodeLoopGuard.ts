import type { AcpToolCallState } from "@t3tools/provider-acp/server/runtimeModel";

/** Consecutive identical completed tool calls before a turn is treated as stuck. */
export const COMMAND_CODE_LOOP_THRESHOLD = 6;

/**
 * Plan mode is a host toggle (`session/set_mode`). Command Code's own
 * `enter_plan_mode` is a deferred tool that weaker models fail to call, then
 * loop on; steer them to answer inline instead.
 */
export const COMMAND_CODE_PLAN_MODE_HINT =
  "Do not call enter_plan_mode or exit_plan_mode; the user switches plan mode in the app. If a plan is needed, research with your normal tools and write the plan in your reply.";

export interface CommandCodeLoopGuard {
  /** Returns a user-facing reason once the same tool call has repeated too often. */
  readonly observe: (toolCall: AcpToolCallState) => string | undefined;
  readonly reset: () => void;
}

function toolCallSignature(toolCall: AcpToolCallState): string {
  return JSON.stringify([
    toolCall.kind ?? null,
    toolCall.title ?? null,
    toolCall.data.rawInput ?? null,
    toolCall.data.content ?? null,
  ]);
}

/**
 * Detects a model stuck re-issuing one tool call with the same input and output,
 * e.g. DeepSeek emitting `shell_command true` forever while trying to call a
 * deferred tool it cannot reach. Anything different in between resets the count.
 */
export function makeCommandCodeLoopGuard(
  threshold: number = COMMAND_CODE_LOOP_THRESHOLD,
): CommandCodeLoopGuard {
  let signature: string | undefined;
  let count = 0;
  const seen = new Set<string>();
  return {
    observe: (toolCall) => {
      if (toolCall.status !== "completed" || seen.has(toolCall.toolCallId)) return undefined;
      seen.add(toolCall.toolCallId);
      const next = toolCallSignature(toolCall);
      count = next === signature ? count + 1 : 1;
      signature = next;
      if (count < threshold) return undefined;
      const label = toolCall.command ?? toolCall.title ?? toolCall.kind ?? "tool call";
      return `Stopped: the agent repeated the same tool call ${count} times in a row (${label}). Retry with a different model or rephrase the request.`;
    },
    reset: () => {
      signature = undefined;
      count = 0;
      seen.clear();
    },
  };
}
