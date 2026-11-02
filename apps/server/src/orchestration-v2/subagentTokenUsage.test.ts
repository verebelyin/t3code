import { describe, expect, it } from "vite-plus/test";
import { ProviderThreadId, RunAttemptId, RunId } from "@t3tools/contracts";

import { claudeTaskTokenUsage, rollUpSubagentTokenUsage } from "./subagentTokenUsage.ts";

const runId = RunId.make("run-child");
const otherRunId = RunId.make("run-other");
const attempt = RunAttemptId.make("attempt-1");
const otherAttempt = RunAttemptId.make("attempt-other");
const providerThreadId = ProviderThreadId.make("provider-thread-1");
const attempts = [
  { id: attempt, runId },
  { id: otherAttempt, runId: otherRunId },
];

describe("rollUpSubagentTokenUsage", () => {
  it("sums only the child run's turns", () => {
    const usage = rollUpSubagentTokenUsage({
      runId,
      providerThreadId,
      attempts,
      providerTurns: [
        {
          runAttemptId: attempt,
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            hasSubagents: false,
            inputTokens: 1_000,
            outputTokens: 200,
            cachedInputTokens: 600,
          },
        },
        {
          runAttemptId: attempt,
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            hasSubagents: false,
            inputTokens: 500,
            outputTokens: 100,
          },
        },
        {
          runAttemptId: otherAttempt,
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            hasSubagents: false,
            inputTokens: 9_999,
            outputTokens: 9_999,
          },
        },
      ],
      providerThreads: [],
    });
    expect(usage).toEqual({
      totalTokens: 1_800,
      inputTokens: 1_500,
      outputTokens: 300,
      cachedInputTokens: 600,
      approximate: false,
    });
  });

  it("marks partial turn reports approximate", () => {
    const usage = rollUpSubagentTokenUsage({
      runId,
      providerThreadId,
      attempts,
      providerTurns: [
        {
          runAttemptId: attempt,
          turnTokenUsage: {
            usageScope: "main_agent",
            usageStatus: "partial",
            hasSubagents: false,
            outputTokens: 40,
          },
        },
      ],
      providerThreads: [],
    });
    expect(usage?.approximate).toBe(true);
    expect(usage?.totalTokens).toBe(40);
  });

  it("falls back to the provider thread's context reading as approximate", () => {
    const usage = rollUpSubagentTokenUsage({
      runId,
      providerThreadId,
      attempts,
      providerTurns: [{ runAttemptId: attempt, turnTokenUsage: undefined }],
      providerThreads: [{ id: providerThreadId, contextUsage: { usedTokens: 42_000 } }],
    });
    expect(usage).toEqual({ totalTokens: 42_000, approximate: true });
  });

  it("reports nothing without any usage source", () => {
    expect(
      rollUpSubagentTokenUsage({
        runId,
        providerThreadId: null,
        attempts,
        providerTurns: [],
        providerThreads: [{ id: providerThreadId, contextUsage: { usedTokens: 1 } }],
      }),
    ).toBeUndefined();
  });
});

describe("claudeTaskTokenUsage", () => {
  it("reads Claude's task total and ignores malformed values", () => {
    expect(claudeTaskTokenUsage({ total_tokens: 12_345 })).toEqual({
      totalTokens: 12_345,
      approximate: false,
    });
    expect(claudeTaskTokenUsage(undefined)).toBeUndefined();
    expect(claudeTaskTokenUsage({ total_tokens: -1 })).toBeUndefined();
  });
});
