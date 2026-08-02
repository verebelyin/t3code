import { describe, expect, it } from "vite-plus/test";

import { buildCodexToolInvocation, stripFileHeaders } from "./codexToolInvocation.ts";

const WITH_DIFFS = { includeDiffs: true } as const;
const WITHOUT_DIFFS = { includeDiffs: false } as const;

describe("stripFileHeaders", () => {
  it("drops git patch headers and keeps the hunk body", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1234567..89abcde 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
    ].join("\n");
    expect(stripFileHeaders(patch)).toBe("@@ -1,2 +1,2 @@\n-old\n+new");
  });

  it("drops new-file and rename headers", () => {
    const patch = [
      "diff --git a/x b/y",
      "similarity index 90%",
      "rename from x",
      "rename to y",
      "@@ -1 +1 @@",
      "-a",
      "+b",
    ].join("\n");
    expect(stripFileHeaders(patch)).toBe("@@ -1 +1 @@\n-a\n+b");
  });

  it("leaves a bare hunk untouched", () => {
    expect(stripFileHeaders("@@ -1 +1 @@\n-a\n+b")).toBe("@@ -1 +1 @@\n-a\n+b");
  });
});

describe("buildCodexToolInvocation", () => {
  it("maps commandExecution to Bash", () => {
    expect(
      buildCodexToolInvocation("command_execution", { command: "pnpm test" }, WITHOUT_DIFFS),
    ).toEqual({ name: "Bash", target: "pnpm test", targetKind: "command" });
  });

  it("maps fileChange to Edit with stripped per-file diffs", () => {
    const invocation = buildCodexToolInvocation(
      "file_change",
      {
        changes: [
          {
            path: "src/a.ts",
            kind: "update",
            diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b",
          },
          { path: "src/b.ts", kind: "add", diff: "@@ -0,0 +1 @@\n+new" },
        ],
      },
      WITH_DIFFS,
    );

    expect(invocation?.name).toBe("Edit");
    expect(invocation?.target).toBe("src/a.ts");
    expect(invocation?.targetKind).toBe("path");
    expect(invocation?.changes).toEqual([
      { path: "src/a.ts", kind: "update", diff: "@@ -1 +1 @@\n-a\n+b" },
      { path: "src/b.ts", kind: "add", diff: "@@ -0,0 +1 @@\n+new" },
    ]);
  });

  it("keeps paths but omits diffs before the item is final", () => {
    const invocation = buildCodexToolInvocation(
      "file_change",
      { changes: [{ path: "src/a.ts", kind: "update", diff: "@@ -1 +1 @@\n-a\n+b" }] },
      WITHOUT_DIFFS,
    );
    expect(invocation?.changes).toEqual([{ path: "src/a.ts", kind: "update" }]);
  });

  it("normalizes change kinds", () => {
    const invocation = buildCodexToolInvocation(
      "file_change",
      {
        changes: [
          { path: "a", kind: "created" },
          { path: "b", kind: "removed" },
          { path: "c", kind: "whatever" },
        ],
      },
      WITHOUT_DIFFS,
    );
    expect(invocation?.changes?.map((change) => change.kind)).toEqual(["add", "delete", "update"]);
  });

  it("skips change entries with no path", () => {
    const invocation = buildCodexToolInvocation(
      "file_change",
      { changes: [{ kind: "update" }, { path: "  " }, { path: "ok.ts" }] },
      WITHOUT_DIFFS,
    );
    expect(invocation?.changes).toEqual([{ path: "ok.ts", kind: "update" }]);
  });

  it("truncates an over-long diff", () => {
    const long = [
      "@@ -1,200 +1,200 @@",
      ...Array.from({ length: 200 }, (_, i) => `+line ${i}`),
    ].join("\n");
    const invocation = buildCodexToolInvocation(
      "file_change",
      { changes: [{ path: "big.ts", kind: "update", diff: long }] },
      WITH_DIFFS,
    );
    const change = invocation?.changes?.[0];
    expect(change?.diffTruncated).toBe(true);
    expect(change?.diff?.split("\n").length).toBeLessThanOrEqual(40);
  });

  it("uses the supplied detail as the web search target", () => {
    expect(
      buildCodexToolInvocation("web_search", {}, { includeDiffs: true, detail: "effect ts docs" }),
    ).toEqual({ name: "WebSearch", target: "effect ts docs", targetKind: "text" });
  });

  it("names MCP calls server:tool", () => {
    expect(
      buildCodexToolInvocation("mcp_tool_call", { server: "ctx", tool: "lookup" }, WITHOUT_DIFFS),
    ).toEqual({ name: "ctx:lookup" });
  });

  it("returns undefined for item types with no named form", () => {
    expect(buildCodexToolInvocation("image_view", {}, WITHOUT_DIFFS)).toBeUndefined();
  });
});
