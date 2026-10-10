import { describe, expect, it } from "@effect/vitest";

import {
  buildCommandCodeSpawnInput,
  commandCodePermissionMode,
  commandCodeModels,
  commandCodeToolInvocation,
} from "./CommandCodeAcpSupport.ts";
import { CommandCodeSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type * as AcpSchema from "effect-acp/compat";
import { normalizeCommandCodeToolCall } from "./CommandCodeProtocol.ts";

const decodeCommandCodeSettings = Schema.decodeSync(CommandCodeSettings);

describe("Command Code ACP support", () => {
  it("builds the managed ACP spawn command", () => {
    expect(
      buildCommandCodeSpawnInput(decodeCommandCodeSettings({}), "/tmp/project", {
        PATH: "/bin",
      }),
    ).toEqual({
      command: "command-code",
      args: ["acp"],
      cwd: "/tmp/project",
      env: { PATH: "/bin", COMMANDCODE_SKIP_UPDATES: "1" },
    });
  });

  it("maps T3 permission modes to native modes", () => {
    expect(commandCodePermissionMode("approval-required")).toBe("default");
    expect(commandCodePermissionMode("auto")).toBe("default");
    expect(commandCodePermissionMode("auto-accept-edits")).toBe("auto-accept");
    expect(commandCodePermissionMode("full-access")).toBe("bypass");
  });

  it("keeps the native current model as the default and scopes effort to it", () => {
    const configOptions = [
      {
        type: "select",
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "model-b",
        options: [
          { value: "model-a", name: "Model A" },
          { value: "model-b", name: "Model B" },
        ],
      },
      {
        type: "select",
        id: "effort",
        name: "Effort",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ] satisfies ReadonlyArray<AcpSchema.SessionConfigOption>;
    const models = commandCodeModels(configOptions);
    expect(models.find((model) => model.slug === "model-a")?.isDefault).toBeUndefined();
    expect(models.find((model) => model.slug === "model-b")?.isDefault).toBe(true);
    expect(models.find((model) => model.slug === "model-a")?.capabilities).toBeNull();
    expect(models.find((model) => model.slug === "model-b")?.capabilities).toBeDefined();
  });

  it("builds a bounded rich tool invocation from native fields", () => {
    expect(
      commandCodeToolInvocation({
        toolCallId: "tool-1",
        title: "Edit",
        data: {
          rawInput: { path: "/tmp/project/file.ts", diff: `${"x".repeat(9_000)}` },
          rawOutput: { combinedOutput: `${"o".repeat(9_000)}`, exitCode: 1 },
          item: { aggregatedOutput: "done" },
        },
      }),
    ).toMatchObject({
      name: "Edit",
      target: "/tmp/project/file.ts",
      targetKind: "path",
      outputTruncated: true,
      exitCode: 1,
    });
    expect(
      commandCodeToolInvocation({
        toolCallId: "tool-2",
        kind: "execute",
        data: { rawInput: { command: "echo ok" }, rawOutput: { combinedOutput: "ok" } },
      }),
    ).toMatchObject({ target: "echo ok", targetKind: "command", output: "ok" });
    expect(
      commandCodeToolInvocation({
        toolCallId: "read-relative",
        kind: "read",
        data: { rawInput: { file_path: "file.ts" } },
      }),
    ).toMatchObject({ target: "file.ts", targetKind: "path" });
    const edit = commandCodeToolInvocation({
      toolCallId: "tool-3",
      title: "edit_file",
      data: {
        rawInput: { file_path: "/tmp/project/file.ts", old_string: "old\n", new_string: "new\n" },
      },
    });
    expect(edit?.changes?.[0]?.diff).toEqual("@@ -1,2 +1,2 @@\n-old\n+new\n ");
    const write = commandCodeToolInvocation({
      toolCallId: "tool-4",
      title: "write_file",
      data: { rawInput: { file_path: "/tmp/project/new.ts", content: "new\n" } },
    });
    expect(write?.changes?.[0]?.diff).toEqual("@@ -1,1 +1,2 @@\n+new\n ");
    const largeWrite = commandCodeToolInvocation(
      normalizeCommandCodeToolCall({
        toolCallId: "large-write",
        kind: "edit",
        data: { rawInput: { file_path: "large.ts", content: "n".repeat(9_000) } },
      }),
    );
    expect(largeWrite?.changes?.[0]?.diffTruncated).toBe(true);
    expect(
      commandCodeToolInvocation({
        toolCallId: "tool-5",
        title: "Read",
        data: { content: [{ type: "content", content: { type: "text", text: "  done\n" } }] },
      })?.output,
    ).toBe("  done\n");
  });
});
