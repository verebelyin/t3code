import { describe, expect, it } from "vite-plus/test";
import { type WorkLogEntry } from "../../session-logic";
import { deriveMessagesTimelineRows, toolCallPanelKind } from "./MessagesTimeline.logic";

// Expand-all mode and tool-call panel classification. Kept apart from
// MessagesTimeline.logic.test.ts so upstream edits there merge cleanly.

describe("toolCallPanelKind", () => {
  const baseEntry: WorkLogEntry = {
    id: "entry-1",
    createdAt: "2026-01-01T00:00:00Z",
    label: "Tool",
    tone: "tool",
  };

  it("classifies file_change items as file", () => {
    expect(toolCallPanelKind({ ...baseEntry, itemType: "file_change" })).toBe("file");
  });

  it("classifies unlabelled tools that report diffs as file", () => {
    expect(
      toolCallPanelKind({
        ...baseEntry,
        itemType: "mcp_tool_call",
        toolInvocation: {
          name: "Edit",
          changes: [{ path: "src/foo.ts", diff: "--- a\n+++ b" }],
        },
      }),
    ).toBe("file");
  });

  it("classifies command_execution items as command", () => {
    expect(toolCallPanelKind({ ...baseEntry, itemType: "command_execution" })).toBe("command");
  });

  it("classifies everything else as other", () => {
    expect(toolCallPanelKind(baseEntry)).toBe("other");
    expect(toolCallPanelKind({ ...baseEntry, itemType: "web_search" })).toBe("other");
    expect(
      toolCallPanelKind({
        ...baseEntry,
        itemType: "mcp_tool_call",
        toolInvocation: { name: "Read", changes: [] },
      }),
    ).toBe("other");
  });
});

describe("deriveMessagesTimelineRows expand-all", () => {
  it("expand-all mode lists every tool call, running ones included, with no toggle row", () => {
    const rows = deriveMessagesTimelineRows({
      timelineEntries: [
        {
          id: "work-entry-1",
          kind: "work" as const,
          createdAt: "2026-01-01T00:00:01Z",
          entry: {
            id: "work-1",
            createdAt: "2026-01-01T00:00:01Z",
            label: "read",
            detail: "Reading package.json",
            tone: "tool" as const,
          },
        },
        {
          id: "work-entry-2",
          kind: "work" as const,
          createdAt: "2026-01-01T00:00:02Z",
          entry: {
            id: "work-2",
            createdAt: "2026-01-01T00:00:02Z",
            label: "bash",
            detail: "Running tests",
            tone: "tool" as const,
            // In-progress entries are neutral-status; expand-all keeps them.
            toolLifecycleStatus: "inProgress" as const,
          },
        },
      ],
      expandAllToolCalls: true,
      isWorking: true,
      activeTurnStartedAt: null,
      turnDiffSummaryByAssistantMessageId: new Map(),
      revertTurnCountByUserMessageId: new Map(),
    });

    expect(rows.filter((row) => row.kind === "work").map((row) => row.id)).toEqual([
      "work-1",
      "work-2",
    ]);
    expect(rows.some((row) => row.kind === "work-toggle")).toBe(false);
  });
});
