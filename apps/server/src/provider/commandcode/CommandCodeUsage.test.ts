import { describe, expect, it } from "vite-plus/test";

import { commandCodeUsageFormat } from "./CommandCodeUsage.ts";

const session = JSON.stringify({
  type: "session",
  version: 3,
  id: "93258367-e612-4d51-b53f-a2e11dad0ba8",
  timestamp: "2026-10-15T19:25:21.169Z",
});

const assistant = (usage: Record<string, unknown>, messageId = "31993a6e") =>
  JSON.stringify({
    type: "message",
    id: "6f00e8ba",
    timestamp: "2026-10-15T19:25:25.753Z",
    message: { role: "assistant", content: [], meta: { messageId } },
    usage,
    model: "deepseek/deepseek-v4.1-flash",
  });

const parse = (...lines: string[]) => {
  const state = commandCodeUsageFormat.state!.initial();
  return lines.flatMap((line) => commandCodeUsageFormat.parseLine(line, state));
};

describe("commandCodeUsageFormat", () => {
  it("splits cached input out of the AI SDK input total and keeps the reported cost", () => {
    const [record] = parse(
      session,
      assistant({
        inputTokens: 27005,
        outputTokens: 94,
        cacheReadTokens: 8192,
        cacheWriteTokens: 1000,
        costUsd: 0.0029,
      }),
    );
    expect(record).toMatchObject({
      provider: "commandcode",
      sessionId: "93258367-e612-4d51-b53f-a2e11dad0ba8",
      model: "deepseek/deepseek-v4.1-flash",
      rateModel: "deepseek-v4.1-flash",
      totals: {
        uncachedInputTokens: 17813,
        cachedInputTokens: 8192,
        cacheCreationTokens: 1000,
        outputTokens: 94,
      },
      reportedCostUsd: 0.0029,
    });
  });

  it("leaves a zero cost to shared pricing and skips empty usage", () => {
    const [free] = parse(assistant({ inputTokens: 10, outputTokens: 5, costUsd: 0 }));
    expect(free?.reportedCostUsd).toBeNull();
    expect(parse(assistant({ inputTokens: 0, outputTokens: 0, costUsd: 0 }))).toEqual([]);
  });

  it("keys records by message id so a forked session's copies de-duplicate", () => {
    const usage = { inputTokens: 10, outputTokens: 5 };
    const [original] = parse(assistant(usage));
    const [forked] = parse(assistant(usage));
    const [other] = parse(assistant(usage, "different"));
    expect(forked?.dedupeKey).toBe(original?.dedupeKey);
    expect(other?.dedupeKey).not.toBe(original?.dedupeKey);
  });

  it("ignores lines without usage", () => {
    expect(
      parse(JSON.stringify({ type: "model_change", id: "x", model: "glm-5.2" }), "not json"),
    ).toEqual([]);
  });
});
