import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectActivityPayload } from "../src/orchestration/ActivityPayloadProjection.ts";

// `payload.tool` pass-through and Claude's flat data shape. Kept apart from
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

const fixtures = [makeActivity("command", "command_execution", { item: { command: "pnpm test" } })];

describe("projectActivityPayload tool invocation", () => {
  it("passes the top-level tool invocation through while still dropping data.input", () => {
    // Load-bearing for `Read(src/foo.ts)` rows: the projection rewrites only
    // `payload.data`, so `payload.tool` reaches clients without widening the
    // allowlist. If this regresses, tool rows silently fall back to the
    // generic heading instead of failing loudly.
    const tool = {
      name: "Edit",
      target: "/repo/src/a.ts",
      targetKind: "path",
      changes: [{ path: "/repo/src/a.ts", kind: "update", diff: "@@ -1,1 +1,1 @@\n-a\n+b" }],
    };
    const activity = {
      ...fixtures[0]!,
      payload: {
        itemType: "file_change",
        tool,
        data: {
          toolName: "Edit",
          input: { file_path: "/repo/src/a.ts", old_string: "a", new_string: "b" },
        },
      },
    } as OrchestrationThreadActivity;

    const payload = projectActivityPayload(activity).payload as Record<string, unknown>;
    expect(payload.tool).toEqual(tool);
    const data = payload.data as Record<string, unknown>;
    expect(data.input).toBeUndefined();
  });

  it("keeps the command from Claude's flat data shape", () => {
    // Claude spreads the call as `data.{toolName,input,result}` with no `item`
    // wrapper. Dropping it here left the client rebuilding the command from the
    // `detail` summary, which renders as a prefixed, clipped `Bash: cd …`.
    const activity = {
      ...fixtures[0]!,
      payload: {
        itemType: "command_execution",
        detail: "Bash: cd /repo && pnpm test --filter web",
        data: {
          toolName: "Bash",
          input: { command: "cd /repo && pnpm test --filter web", description: "run tests" },
          result: { content: "first line of output\nbulk output that must not ship" },
        },
      },
    } as OrchestrationThreadActivity;

    const data = projectActivityPayload(activity).payload.data as Record<string, unknown>;
    expect(data.item).toEqual({
      input: { command: "cd /repo && pnpm test --filter web" },
      result: { content: "first line of output" },
    });
    // The rest of the input and everything past the result's summary line are still dropped.
    expect(JSON.stringify(data)).not.toContain("bulk output");
    expect(JSON.stringify(data)).not.toContain("run tests");
  });
});
