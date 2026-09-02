import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveLatestRateLimitsSnapshot } from "../../web/src/lib/rateLimits.ts";
import { projectThreadDetailSnapshot } from "../src/orchestration/ActivityPayloadProjection.ts";

// `account-rate-limits.updated` snapshot dedup. Kept apart from
// ActivityPayloadProjection.test.ts so upstream edits there merge cleanly.

function makeActivity(
  id: string,
  itemType: string,
  data: Record<string, unknown>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "tool",
    kind: "tool.completed",
    summary: `Completed ${itemType}`,
    payload: {
      itemType,
      title: itemType,
      detail: `${itemType} detail`,
      status: "completed",
      requestKind: "command",
      data,
    },
    turnId: TurnId.make(`turn-${id}`),
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

function makeThread(activities: ReadonlyArray<OrchestrationThreadActivity>): OrchestrationThread {
  return {
    id: ThreadId.make("thread-projection"),
    projectId: ProjectId.make("project-projection"),
    title: "Activity projection",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities,
    checkpoints: [],
    session: null,
  };
}

const fixtures = [makeActivity("command", "command_execution", { item: { command: "pnpm test" } })];

describe("account rate-limits snapshot dedup", () => {
  function makeRateLimitsActivity(
    id: string,
    fiveHourPercent: number,
    turn = `turn-${id}`,
  ): OrchestrationThreadActivity {
    return {
      id: EventId.make(id),
      tone: "info",
      kind: "account-rate-limits.updated",
      summary: "Account rate limits updated",
      payload: {
        provider: "claudeAgent",
        fiveHour: { usedPercent: fiveHourPercent, resetsAt: "2026-07-27T05:00:00.000Z" },
        weekly: { usedPercent: 12 },
        planType: "max",
      },
      turnId: TurnId.make(turn),
      createdAt: "2026-07-27T00:00:00.000Z",
    };
  }

  it("keeps only the latest account rate-limits activity per turn in snapshots", () => {
    const stale1 = makeRateLimitsActivity("rl-1", 10, "turn-a");
    const stale2 = makeRateLimitsActivity("rl-2", 20, "turn-a");
    const latestA = makeRateLimitsActivity("rl-3", 30, "turn-a");
    const latestB = makeRateLimitsActivity("rl-4", 40, "turn-b");
    const tool = fixtures[0]!;

    const projected = projectThreadDetailSnapshot({
      snapshotSequence: 7,
      thread: makeThread([stale1, stale2, tool, latestA, latestB]),
    });

    expect(projected.thread.activities.map((activity) => activity.id)).toEqual([
      tool.id,
      latestA.id,
      latestB.id,
    ]);
    expect(projected.thread.activities[2]?.payload).toEqual(latestB.payload);
  });

  it("matches what the web client derives from the full history", () => {
    const activities = [makeRateLimitsActivity("rl-1", 10), makeRateLimitsActivity("rl-2", 20)];
    const projected = projectThreadDetailSnapshot({
      snapshotSequence: 7,
      thread: makeThread(activities),
    });

    expect(deriveLatestRateLimitsSnapshot(projected.thread.activities)).toEqual(
      deriveLatestRateLimitsSnapshot(activities),
    );
  });

  it("does not let a malformed row shadow an earlier valid row in the same turn", () => {
    const valid = makeRateLimitsActivity("rl-valid", 55, "turn-a");
    const malformed: OrchestrationThreadActivity = {
      ...makeRateLimitsActivity("rl-broken", 0, "turn-a"),
      payload: { provider: "claudeAgent", fiveHour: { usedPercent: null } },
    };

    const projected = projectThreadDetailSnapshot({
      snapshotSequence: 7,
      thread: makeThread([valid, malformed]),
    });

    expect(projected.thread.activities.map((activity) => activity.id)).toEqual([
      valid.id,
      malformed.id,
    ]);
    expect(deriveLatestRateLimitsSnapshot(projected.thread.activities)).toEqual(
      deriveLatestRateLimitsSnapshot([valid, malformed]),
    );
  });

  it("dedups rate-limit rows and context-window rows independently", () => {
    const staleRateLimits = makeRateLimitsActivity("rl-stale", 10, "turn-a");
    const latestRateLimits = makeRateLimitsActivity("rl-latest", 20, "turn-a");
    const contextWindow: OrchestrationThreadActivity = {
      id: EventId.make("ctx-mixed"),
      tone: "info",
      kind: "context-window.updated",
      summary: "Context window updated",
      payload: { usedTokens: 1_000, maxTokens: 200_000 },
      turnId: TurnId.make("turn-a"),
      createdAt: "2026-07-27T00:00:00.000Z",
    };

    const projected = projectThreadDetailSnapshot({
      snapshotSequence: 7,
      thread: makeThread([staleRateLimits, contextWindow, latestRateLimits]),
    });

    expect(projected.thread.activities.map((activity) => activity.id)).toEqual([
      contextWindow.id,
      latestRateLimits.id,
    ]);
  });
});
