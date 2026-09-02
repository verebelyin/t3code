import {
  classifyTaskAgentKind,
  EventId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveWorkLogEntries } from "./session-logic";

// Tool-invocation (`payload.tool`), task telemetry and exit-code coverage for
// deriveWorkLogEntries. Lives beside session-logic.test.ts so upstream edits
// to that file merge without conflicts.

let nextActivityId = 0;

function makeActivity(overrides: {
  id?: string;
  createdAt?: string;
  kind?: string;
  summary?: string;
  tone?: OrchestrationThreadActivity["tone"];
  payload?: Record<string, unknown>;
  turnId?: string;
  sequence?: number;
}): OrchestrationThreadActivity {
  // Fixtures model post-ingestion rows: ingestion stamps agentKind on every
  // task.* payload. Pass an explicit agentKind to model legacy rows.
  const rawPayload = overrides.payload ?? {};
  const payload =
    overrides.kind?.startsWith("task.") && !("agentKind" in rawPayload)
      ? {
          ...rawPayload,
          agentKind: classifyTaskAgentKind({
            taskType: typeof rawPayload.taskType === "string" ? rawPayload.taskType : undefined,
            agentId: typeof rawPayload.agentId === "string" ? rawPayload.agentId : undefined,
          }),
        }
      : rawPayload;
  return {
    id: EventId.make(overrides.id ?? `activity-${nextActivityId++}`),
    createdAt: overrides.createdAt ?? "2026-02-23T00:00:00.000Z",
    kind: overrides.kind ?? "tool.started",
    summary: overrides.summary ?? "Tool call",
    tone: overrides.tone ?? "tool",
    payload,
    turnId: overrides.turnId ? TurnId.make(overrides.turnId) : null,
    ...(overrides.sequence !== undefined ? { sequence: overrides.sequence } : {}),
  };
}

describe("deriveWorkLogEntries tool invocations", () => {
  it("carries payload.tool through as toolInvocation", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "tool-1",
        kind: "tool.completed",
        summary: "File change",
        payload: {
          itemType: "file_change",
          tool: {
            name: "Edit",
            target: "/repo/src/a.ts",
            targetKind: "path",
            changes: [{ path: "/repo/src/a.ts", kind: "update", diff: "@@ -1,1 +1,1 @@\n-a\n+b" }],
          },
        },
      }),
    ]);

    expect(entries[0]?.toolInvocation).toEqual({
      name: "Edit",
      target: "/repo/src/a.ts",
      targetKind: "path",
      changes: [{ path: "/repo/src/a.ts", kind: "update", diff: "@@ -1,1 +1,1 @@\n-a\n+b" }],
    });
  });

  it("drops a malformed tool payload rather than rendering garbage", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "tool-1",
        kind: "tool.completed",
        payload: { itemType: "file_change", tool: { target: "no name here" } },
      }),
    ]);
    expect(entries[0]?.toolInvocation).toBeUndefined();
  });

  it("ignores unknown targetKind and change entries without a path", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "tool-1",
        kind: "tool.completed",
        payload: {
          itemType: "file_change",
          tool: {
            name: "Edit",
            target: "x",
            targetKind: "bogus",
            changes: [{ kind: "update" }, { path: "/ok.ts" }],
          },
        },
      }),
    ]);
    expect(entries[0]?.toolInvocation).toEqual({
      name: "Edit",
      target: "x",
      changes: [{ path: "/ok.ts" }],
    });
  });

  it("collapses a command's lifecycle across interleaved task rows", () => {
    // Claude runs harness-tracked bash as a local_bash task whose
    // started/completed rows land BETWEEN the command's streaming update and
    // its completion. Adjacency-only matching rendered the same call twice
    // (once "no output", once complete).
    const command = {
      itemType: "command_execution",
      detail: "Bash: bun run runs:gcp",
      tool: { name: "Bash", target: "bun run runs:gcp", targetKind: "text" },
    };
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "cmd-streaming",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Command run",
        payload: command,
      }),
      makeActivity({
        id: "task-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.started",
        summary: "local_bash task started",
        payload: { taskId: "task-1", taskType: "local_bash" },
      }),
      makeActivity({
        id: "task-done",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task completed",
        payload: { taskId: "task-1", taskType: "local_bash" },
      }),
      makeActivity({
        id: "cmd-complete",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "tool.completed",
        summary: "Command run",
        payload: { ...command, tool: { ...command.tool, output: "COMPLETE" } },
      }),
    ]);

    const commandEntries = entries.filter((entry) => entry.itemType === "command_execution");
    expect(commandEntries).toHaveLength(1);
    expect(commandEntries[0]?.toolLifecycleStatus).toBe("completed");
    expect(commandEntries[0]?.toolInvocation?.output).toBe("COMPLETE");
  });

  it("prefers the diff-bearing invocation when collapsing lifecycle entries", () => {
    // The streaming tool.updated carries name+target only; tool.completed adds
    // the diff. Collapsing must keep the diff regardless of arrival order.
    const entries = deriveWorkLogEntries([
      makeActivity({
        id: "tool-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "File change",
        payload: {
          itemType: "file_change",
          data: { toolCallId: "call-1" },
          tool: { name: "Edit", target: "/repo/a.ts", targetKind: "path" },
        },
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "File change",
        payload: {
          itemType: "file_change",
          data: { toolCallId: "call-1" },
          tool: {
            name: "Edit",
            target: "/repo/a.ts",
            targetKind: "path",
            changes: [{ path: "/repo/a.ts", kind: "update", diff: "@@ -1,1 +1,1 @@\n-a\n+b" }],
          },
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.toolInvocation?.changes?.[0]?.diff).toBe("@@ -1,1 +1,1 @@\n-a\n+b");
  });

  it("groups tool entries identically with and without a tool payload", () => {
    // Grouping regression guard: `payload.tool` is additive, so the "N tool
    // calls" collapse must be unaffected by its presence.
    const build = (withTool: boolean) =>
      deriveWorkLogEntries([
        makeActivity({
          id: "tool-update",
          createdAt: "2026-02-23T00:00:01.000Z",
          kind: "tool.updated",
          summary: "File change",
          payload: {
            itemType: "file_change",
            data: { toolCallId: "call-1" },
            ...(withTool ? { tool: { name: "Edit", target: "/repo/a.ts" } } : {}),
          },
        }),
        makeActivity({
          id: "tool-complete",
          createdAt: "2026-02-23T00:00:02.000Z",
          kind: "tool.completed",
          summary: "File change",
          payload: {
            itemType: "file_change",
            data: { toolCallId: "call-1" },
            ...(withTool ? { tool: { name: "Edit", target: "/repo/a.ts" } } : {}),
          },
        }),
      ]);

    const withTool = build(true).map(({ toolInvocation: _ignored, ...rest }) => rest);
    expect(withTool).toEqual(build(false));
  });

  it("keeps the exit code that gets stripped off a command detail", () => {
    const [entry] = deriveWorkLogEntries([
      makeActivity({
        id: "failing-command",
        kind: "tool.completed",
        summary: "bash",
        payload: {
          itemType: "command_execution",
          title: "bash",
          detail: "boom: no such file <exited with exit code 2>",
          data: { item: { command: "cat missing.txt" } },
        },
      }),
    ]);
    // The suffix is stripped from the shown output but survives as a status.
    expect(entry?.detail).toBe("boom: no such file");
    expect(entry?.exitCode).toBe(2);
  });

  it("keeps subagent progress telemetry off a task.progress payload", () => {
    // Payload shape taken verbatim from a real `task.progress` row.
    const [entry] = deriveWorkLogEntries([
      makeActivity({
        id: "task-progress",
        kind: "task.progress",
        summary: "Running Check for orphaned code",
        payload: {
          taskId: "aed2650380da4ceaa",
          title: "Running Check for orphaned code",
          detail: "Running Check for orphaned code",
          lastToolName: "Bash",
          usage: { total_tokens: 80_339, tool_uses: 12, duration_ms: 139_792 },
        },
      }),
    ]);
    expect(entry?.taskMeta).toEqual({
      lastToolName: "Bash",
      toolUses: 12,
      durationMs: 139_792,
      totalTokens: 80_339,
    });
  });

  it("drops zeroed task counters rather than rendering 0 tools", () => {
    const [entry] = deriveWorkLogEntries([
      makeActivity({
        id: "task-fresh",
        kind: "task.started",
        summary: "Running setup",
        payload: {
          taskId: "t1",
          detail: "Running setup",
          usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 },
        },
      }),
    ]);
    expect(entry?.taskMeta).toBeUndefined();
  });

  it("leaves taskMeta unset for ordinary tool calls", () => {
    const [entry] = deriveWorkLogEntries([
      makeActivity({
        id: "plain-tool",
        kind: "tool.completed",
        summary: "bash",
        payload: { itemType: "command_execution", data: { item: { command: "ls" } } },
      }),
    ]);
    expect(entry?.taskMeta).toBeUndefined();
  });

  it("leaves exitCode unset for a non-command tool call", () => {
    const [entry] = deriveWorkLogEntries([
      makeActivity({
        id: "read-tool",
        kind: "tool.completed",
        summary: "Read",
        payload: {
          itemType: "dynamic_tool_call",
          detail: "some text <exited with exit code 3>",
        },
      }),
    ]);
    expect(entry?.exitCode).toBeUndefined();
  });
});
