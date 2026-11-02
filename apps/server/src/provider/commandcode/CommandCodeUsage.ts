/** Fork: native Command Code session usage for the Usage page. */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { CommandCodeSettings } from "@t3tools/contracts";
import {
  parseTimestampMs,
  tokenCount,
  totalTokens,
  type ProviderUsageReader,
  type TranscriptUsageFormat,
  type UsageRecord,
} from "@t3tools/provider-core/server/usage";
import * as HostProcess from "@t3tools/shared/HostProcess";

const CommandCodeScanState = Schema.Struct({ sessionId: Schema.mutableKey(Schema.String) });
const Entry = Schema.Union([
  Schema.Struct({ type: Schema.Literal("session"), id: Schema.NonEmptyString }),
  Schema.Struct({
    type: Schema.Literal("message"),
    id: Schema.NonEmptyString,
    timestamp: Schema.String,
    model: Schema.NonEmptyString,
    message: Schema.optional(
      Schema.Struct({
        meta: Schema.optional(Schema.Struct({ messageId: Schema.optional(Schema.String) })),
      }),
    ),
    usage: Schema.Struct({
      inputTokens: Schema.optional(Schema.Unknown),
      outputTokens: Schema.optional(Schema.Unknown),
      cacheReadTokens: Schema.optional(Schema.Unknown),
      cacheWriteTokens: Schema.optional(Schema.Unknown),
      costUsd: Schema.optional(Schema.Unknown),
    }),
  }),
]);
const decodeEntry = Schema.decodeUnknownOption(Entry);

function parseRecord(
  parsed: unknown,
  state: typeof CommandCodeScanState.Type,
): readonly UsageRecord[] {
  const decoded = decodeEntry(parsed);
  if (Option.isNone(decoded)) return [];
  const entry = decoded.value;
  if (entry.type === "session") {
    state.sessionId = entry.id;
    return [];
  }
  const timestampMs = parseTimestampMs(entry.timestamp);
  if (timestampMs === null) return [];
  const { usage } = entry;
  const cachedInputTokens = tokenCount(usage.cacheReadTokens);
  const cacheCreationTokens = tokenCount(usage.cacheWriteTokens);
  const totals = {
    // AI SDK totals: inputTokens already includes cache reads and writes.
    uncachedInputTokens: Math.max(
      0,
      tokenCount(usage.inputTokens) - cachedInputTokens - cacheCreationTokens,
    ),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens: tokenCount(usage.outputTokens),
    reasoningTokens: 0,
  };
  const cost = usage.costUsd;
  // Free models report zero; let shared pricing estimate API-equivalent cost.
  const reportedCostUsd =
    typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
  if (totalTokens(totals) === 0 && reportedCostUsd === null) return [];
  return [
    {
      provider: "commandcode",
      timestampMs,
      model: entry.model,
      // The rate table keys models without Command Code's vendor prefix.
      rateModel: entry.model.slice(entry.model.lastIndexOf("/") + 1),
      sessionId: state.sessionId,
      totals,
      reportedCostUsd,
      speed: "standard",
      // A forked session copies entries verbatim; the message UUID survives the copy.
      dedupeKey: JSON.stringify([
        "commandcode",
        entry.message?.meta?.messageId ?? entry.id,
        entry.timestamp,
      ]),
    },
  ];
}

export const commandCodeUsageFormat: TranscriptUsageFormat<typeof CommandCodeScanState.Type> = {
  selectFields: {
    type: true,
    id: true,
    timestamp: true,
    model: true,
    usage: true,
    message: { meta: { messageId: true } },
  },
  usageMarkers: ['"usage"', '"session"'],
  parseLine: (line, state) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return [];
    }
    return parseRecord(parsed, state);
  },
  parseProjected: parseRecord,
  state: { initial: () => ({ sessionId: "" }), schema: CommandCodeScanState },
};

/** Sessions live under `~/.commandcode/projects/<project>/<session>.jsonl`; the CLI has no override. */
export const commandCodeUsageReader: ProviderUsageReader<CommandCodeSettings, Path.Path> = {
  kind: "transcripts",
  provider: "commandcode",
  format: commandCodeUsageFormat,
  directories: Effect.fn("commandCodeUsageReader.directories")(function* ({ environment }) {
    const path = yield* Path.Path;
    // The CLI resolves its home with os.homedir(), which follows the instance's HOME.
    const home = environment.HOME?.trim() || (yield* HostProcess.HomeDirectory);
    return [{ dir: path.join(home, ".commandcode", "projects") }];
  }),
};
