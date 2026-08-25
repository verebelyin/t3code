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

  it("keeps app details and approval options available to remote clients", () => {
    const options = [
      { decision: "decline", label: "Decline" },
      { decision: "acceptAlways", label: "Always allow Safari" },
      { decision: "accept", label: "Approve" },
    ] as const;
    const event = {
      type: "request.opened",
      eventId: EventId.make("evt-mcp-elicitation"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-08-24T00:00:00.000Z",
      threadId: ThreadId.make("thread-1"),
      requestId: RuntimeRequestId.make("approval-safari"),
      payload: {
        requestType: "mcp_elicitation_approval",
        detail: "Allow ChatGPT to use Safari?",
        appName: "Safari",
        options,
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);

    expect(activity).toMatchObject({
      kind: "approval.requested",
      summary: "App access approval requested",
      payload: {
        requestId: "approval-safari",
        requestKind: "mcp-elicitation",
        requestType: "mcp_elicitation_approval",
        detail: "Allow ChatGPT to use Safari?",
        appName: "Safari",
        options,
      },
    });
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
