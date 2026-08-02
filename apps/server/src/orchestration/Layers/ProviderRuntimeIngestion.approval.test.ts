import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

describe("runtimeEventToActivities approval details", () => {
  it("preserves complete multiline command details", () => {
    const detail = `bun run release -- ${"long-argument ".repeat(20)}\nsecond line`;
    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-request-opened"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-07-18T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-1"),
      payload: {
        requestType: "command_execution_approval",
        detail,
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);

    expect(activity?.kind).toBe("approval.requested");
    expect((activity?.payload as Record<string, unknown> | undefined)?.detail).toBe(detail);
  });
});

describe("runtimeEventToActivities subagent linkage", () => {
  it("carries item identity and the parent link onto the activity", () => {
    // Without both halves the client cannot nest: it needs the parent's own id
    // to match against, and the child's pointer to match with.
    const [activity] = runtimeEventToActivities({
      type: "item.started",
      eventId: EventId.make("evt-item-started"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: "2026-08-02T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      itemId: RuntimeItemId.make("toolu_child"),
      payload: {
        itemType: "command_execution",
        status: "inProgress",
        parentToolCallId: "toolu_task",
      },
    } satisfies ProviderRuntimeEvent);

    expect(activity?.payload).toMatchObject({
      providerItemId: "toolu_child",
      parentToolCallId: "toolu_task",
    });
  });

  it("leaves the parent link off the main agent's own calls", () => {
    const [activity] = runtimeEventToActivities({
      type: "item.started",
      eventId: EventId.make("evt-item-started-main"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: "2026-08-02T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      itemId: RuntimeItemId.make("toolu_main"),
      payload: { itemType: "command_execution", status: "inProgress" },
    } satisfies ProviderRuntimeEvent);

    const payload = activity?.payload as Record<string, unknown>;
    expect(payload.providerItemId).toBe("toolu_main");
    expect(payload.parentToolCallId).toBeUndefined();
  });
});

describe("runtimeEventToActivities task reports", () => {
  // A subagent's report is the deliverable of running it. The row preview limit
  // used to apply to the body too, cutting every report to a sentence and a half.
  const longReport = `## Findings\n\n${"A real finding sentence that carries detail. ".repeat(60)}`;

  const taskCompleted = (summary: string) =>
    ({
      type: "task.completed",
      eventId: EventId.make("evt-task-completed"),
      provider: ProviderDriverKind.make("claudeAgent"),
      createdAt: "2026-08-02T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      payload: { taskId: RuntimeTaskId.make("task-1"), status: "completed", summary },
    }) satisfies ProviderRuntimeEvent;

  it("keeps the full report in detail while the label stays short", () => {
    const [activity] = runtimeEventToActivities(taskCompleted(longReport));
    const payload = activity?.payload as Record<string, unknown>;

    expect(longReport.length).toBeGreaterThan(1_000);
    expect(payload.detail).toBe(longReport);
    // The label is a row heading, so it keeps the preview-sized limit.
    expect((payload.summary as string).length).toBe(180);
  });

  it("still bounds a runaway report", () => {
    const runaway = "x".repeat(20_000);
    const payload = runtimeEventToActivities(taskCompleted(runaway))[0]?.payload as Record<
      string,
      unknown
    >;

    expect((payload.detail as string).length).toBe(8_000);
    expect(payload.detail).toMatch(/\.\.\.$/);
  });
});
