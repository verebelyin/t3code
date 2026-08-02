import { describe, expect, it } from "vite-plus/test";

import {
  collapseTargetWhitespace,
  formatToolInvocationLabel,
  toolDisplayName,
} from "./toolInvocationLabel.ts";

describe("toolDisplayName", () => {
  it("passes Claude tool names through unchanged", () => {
    for (const name of [
      "Read",
      "Write",
      "Edit",
      "MultiEdit",
      "NotebookEdit",
      "Grep",
      "Glob",
      "Bash",
      "Task",
      "WebFetch",
      "WebSearch",
    ]) {
      expect(toolDisplayName(name)).toBe(name);
    }
  });

  it("maps Codex canonical item types onto Claude vocabulary", () => {
    expect(toolDisplayName("commandExecution")).toBe("Bash");
    expect(toolDisplayName("fileChange")).toBe("Edit");
    expect(toolDisplayName("webSearch")).toBe("WebSearch");
  });

  it("maps ACP tool kinds onto Claude vocabulary", () => {
    expect(toolDisplayName("read")).toBe("Read");
    expect(toolDisplayName("edit")).toBe("Edit");
    expect(toolDisplayName("execute")).toBe("Bash");
    expect(toolDisplayName("search")).toBe("Grep");
    expect(toolDisplayName("fetch")).toBe("WebFetch");
  });

  it("normalizes separators and casing when matching", () => {
    expect(toolDisplayName("command_execution")).toBe("Bash");
    expect(toolDisplayName("command execution")).toBe("Bash");
    expect(toolDisplayName("COMMANDEXECUTION")).toBe("Bash");
  });

  it("rewrites MCP tool ids as server:tool", () => {
    expect(toolDisplayName("mcp__context7__query-docs")).toBe("context7:query-docs");
    expect(toolDisplayName("mcp__claude-in-chrome__navigate")).toBe("claude-in-chrome:navigate");
  });

  it("keeps double underscores inside the MCP tool segment", () => {
    expect(toolDisplayName("mcp__server__a__b")).toBe("server:a__b");
  });

  it("title-cases unknown tools rather than dropping them", () => {
    expect(toolDisplayName("customThing")).toBe("CustomThing");
  });

  it("returns empty string for blank input", () => {
    expect(toolDisplayName("   ")).toBe("");
  });
});

describe("collapseTargetWhitespace", () => {
  it("collapses newlines and runs of spaces to single spaces", () => {
    expect(collapseTargetWhitespace("pnpm test\n  --filter web")).toBe("pnpm test --filter web");
  });
});

describe("formatToolInvocationLabel", () => {
  it("renders name(target)", () => {
    expect(formatToolInvocationLabel({ name: "Read", target: "src/foo.ts" })).toBe(
      "Read(src/foo.ts)",
    );
    expect(formatToolInvocationLabel({ name: "Bash", target: "pnpm test run" })).toBe(
      "Bash(pnpm test run)",
    );
  });

  it("renders the bare verb when there is no target", () => {
    expect(formatToolInvocationLabel({ name: "Read" })).toBe("Read");
    expect(formatToolInvocationLabel({ name: "Read", target: "   " })).toBe("Read");
  });

  it("collapses multi-line targets so the row stays single-line", () => {
    expect(formatToolInvocationLabel({ name: "Bash", target: "a\nb" })).toBe("Bash(a b)");
  });

  it("does not reformat path targets — callers own relativization", () => {
    expect(
      formatToolInvocationLabel({
        name: "Read",
        target: "/abs/src/foo.ts",
        targetKind: "path",
      }),
    ).toBe("Read(/abs/src/foo.ts)");
  });

  it("returns empty string when the name is blank", () => {
    expect(formatToolInvocationLabel({ name: "", target: "x" })).toBe("");
  });
});
