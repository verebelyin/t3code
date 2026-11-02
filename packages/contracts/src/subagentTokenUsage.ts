import * as Schema from "effect/Schema";

import { NonNegativeInt } from "./baseSchemas.ts";

/**
 * Fork: tokens a subagent spent, rolled up when its work is reported. Exact
 * when the provider reports per-turn or per-task totals; `approximate` when
 * only a context-size reading exists (ACP providers such as Command Code).
 */
export const SubagentTokenUsage = Schema.Struct({
  totalTokens: NonNegativeInt,
  inputTokens: Schema.optional(NonNegativeInt),
  cachedInputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  reasoningTokens: Schema.optional(NonNegativeInt),
  approximate: Schema.Boolean,
});
export type SubagentTokenUsage = typeof SubagentTokenUsage.Type;
