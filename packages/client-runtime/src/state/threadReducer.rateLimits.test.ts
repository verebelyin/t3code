import { describe, expect, it } from "vite-plus/test";

import { EventId, ProjectId, ProviderInstanceId, ThreadId, TurnId } from "@t3tools/contracts";
import type { OrchestrationThread } from "@t3tools/contracts";

import { applyThreadDetailEvent } from "./threadReducer.ts";

// `account-rate-limits.updated` retention in the client reducer. Kept apart
// from threadReducer.test.ts so upstream edits there merge cleanly.

const baseEventFields = {
  eventId: EventId.make("event-1"),
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
} as const;

const baseThread: OrchestrationThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Test Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

describe("applyThreadDetailEvent account rate limits", () => {
  describe("thread.activity-appended", () => {
    it("replaces earlier resolvable rate-limit updates for the same turn", () => {
      const rateLimitActivity = (id: string, sequence: number, payload: unknown) => ({
        id: EventId.make(id),
        tone: "info" as const,
        kind: "account-rate-limits.updated",
        summary: "Rate limits updated",
        payload,
        turnId: TurnId.make("turn-1"),
        sequence,
        createdAt: "2026-04-01T11:00:00.000Z",
      });
      const existingActivities = [
        rateLimitActivity("activity-rl-1", 1, {
          provider: "claude",
          fiveHour: { usedPercent: 10 },
        }),
        {
          ...rateLimitActivity("activity-rl-other-turn", 2, {
            provider: "claude",
            weekly: { usedPercent: 20 },
          }),
          turnId: TurnId.make("turn-0"),
        },
        // Malformed row (no finite usedPercent): must survive, and must not be
        // treated as the latest value by consumers.
        rateLimitActivity("activity-rl-malformed", 3, { provider: "claude", fiveHour: {} }),
        rateLimitActivity("activity-rl-2", 4, {
          provider: "claude",
          weekly: { usedPercent: 30 },
        }),
      ];

      const result = applyThreadDetailEvent(
        { ...baseThread, activities: existingActivities },
        {
          ...baseEventFields,
          sequence: 22,
          occurredAt: "2026-04-01T11:04:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: rateLimitActivity("activity-rl-3", 5, {
              provider: "claude",
              fiveHour: { usedPercent: 40 },
            }),
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        const ids = result.thread.activities.map((activity) => activity.id);
        // Same-turn resolvable rows collapse to the newest; the other turn's
        // row and the malformed row are untouched.
        expect(ids).toEqual(["activity-rl-other-turn", "activity-rl-malformed", "activity-rl-3"]);
      }
    });

    it("does not collapse rate-limit history for a malformed update", () => {
      const resolvable = {
        id: EventId.make("activity-rl-resolvable"),
        tone: "info" as const,
        kind: "account-rate-limits.updated",
        summary: "Rate limits updated",
        payload: { provider: "claude", fiveHour: { usedPercent: 55 } },
        turnId: TurnId.make("turn-1"),
        sequence: 1,
        createdAt: "2026-04-01T11:00:00.000Z",
      };

      const result = applyThreadDetailEvent(
        { ...baseThread, activities: [resolvable] },
        {
          ...baseEventFields,
          sequence: 23,
          occurredAt: "2026-04-01T11:05:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: {
              ...resolvable,
              id: EventId.make("activity-rl-broken"),
              payload: { provider: "claude", fiveHour: { usedPercent: Number.NaN } },
              sequence: 2,
            },
          },
        },
      );

      expect(result.kind).toBe("updated");
      if (result.kind === "updated") {
        // The resolvable row must survive so consumers can still derive usage
        // by walking backwards past the malformed row.
        const ids = result.thread.activities.map((activity) => activity.id);
        expect(ids).toEqual(["activity-rl-resolvable", "activity-rl-broken"]);
      }
    });

    it("keeps context-window and rate-limit rows independent of each other", () => {
      const sharedFields = {
        tone: "info" as const,
        turnId: TurnId.make("turn-1"),
        createdAt: "2026-04-01T11:00:00.000Z",
      };
      const existingActivities = [
        {
          ...sharedFields,
          id: EventId.make("activity-cw"),
          kind: "context-window.updated",
          summary: "Context window updated",
          payload: { usedTokens: 1_000 },
          sequence: 1,
        },
        {
          ...sharedFields,
          id: EventId.make("activity-rl"),
          kind: "account-rate-limits.updated",
          summary: "Rate limits updated",
          payload: { provider: "claude", fiveHour: { usedPercent: 12 } },
          sequence: 2,
        },
      ];

      const withNewRateLimits = applyThreadDetailEvent(
        { ...baseThread, activities: existingActivities },
        {
          ...baseEventFields,
          sequence: 24,
          occurredAt: "2026-04-01T11:06:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: {
              ...sharedFields,
              id: EventId.make("activity-rl-next"),
              kind: "account-rate-limits.updated",
              summary: "Rate limits updated",
              payload: { provider: "claude", weekly: { usedPercent: 34 } },
              sequence: 3,
            },
          },
        },
      );

      expect(withNewRateLimits.kind).toBe("updated");
      if (withNewRateLimits.kind === "updated") {
        const ids = withNewRateLimits.thread.activities.map((activity) => activity.id);
        expect(ids).toEqual(["activity-cw", "activity-rl-next"]);
      }

      const withNewContextWindow = applyThreadDetailEvent(
        { ...baseThread, activities: existingActivities },
        {
          ...baseEventFields,
          sequence: 25,
          occurredAt: "2026-04-01T11:07:00.000Z",
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          type: "thread.activity-appended",
          payload: {
            threadId: ThreadId.make("thread-1"),
            activity: {
              ...sharedFields,
              id: EventId.make("activity-cw-next"),
              kind: "context-window.updated",
              summary: "Context window updated",
              payload: { usedTokens: 2_000 },
              sequence: 3,
            },
          },
        },
      );

      expect(withNewContextWindow.kind).toBe("updated");
      if (withNewContextWindow.kind === "updated") {
        const ids = withNewContextWindow.thread.activities.map((activity) => activity.id);
        expect(ids).toEqual(["activity-rl", "activity-cw-next"]);
      }
    });
  });
});
