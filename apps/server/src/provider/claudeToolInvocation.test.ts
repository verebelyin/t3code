import { describe, expect, it } from "vite-plus/test";

import { buildClaudeToolInvocation } from "./claudeToolInvocation.ts";

const WITH_DIFFS = { includeDiffs: true } as const;
const WITHOUT_DIFFS = { includeDiffs: false } as const;

describe("buildClaudeToolInvocation — target extraction", () => {
  it("reads file_path for the file tools", () => {
    for (const tool of ["Read", "Write", "Edit", "MultiEdit"]) {
      const invocation = buildClaudeToolInvocation(
        tool,
        { file_path: "/repo/src/a.ts" },
        WITHOUT_DIFFS,
      );
      expect(invocation?.target).toBe("/repo/src/a.ts");
      expect(invocation?.targetKind).toBe("path");
    }
  });

  it("prefers notebook_path for NotebookEdit", () => {
    const invocation = buildClaudeToolInvocation(
      "NotebookEdit",
      { notebook_path: "/repo/nb.ipynb", file_path: "/repo/other.ts" },
      WITHOUT_DIFFS,
    );
    expect(invocation?.target).toBe("/repo/nb.ipynb");
  });

  it("reads pattern for Grep and Glob", () => {
    expect(
      buildClaudeToolInvocation("Grep", { pattern: "formatWorkspace" }, WITHOUT_DIFFS),
    ).toMatchObject({ target: "formatWorkspace", targetKind: "pattern" });
    expect(buildClaudeToolInvocation("Glob", { pattern: "**/*.ts" }, WITHOUT_DIFFS)).toMatchObject({
      target: "**/*.ts",
      targetKind: "pattern",
    });
  });

  it("reads command for Bash", () => {
    expect(
      buildClaudeToolInvocation("Bash", { command: "pnpm test run" }, WITHOUT_DIFFS),
    ).toMatchObject({ target: "pnpm test run", targetKind: "command" });
  });

  it("falls back from description to subagent_type for Task", () => {
    expect(
      buildClaudeToolInvocation("Task", { description: "Explore agent" }, WITHOUT_DIFFS),
    ).toMatchObject({ target: "Explore agent", targetKind: "agent" });
    expect(
      buildClaudeToolInvocation("Task", { subagent_type: "Explore" }, WITHOUT_DIFFS),
    ).toMatchObject({ target: "Explore", targetKind: "agent" });
  });

  it("reads url for WebFetch and query for WebSearch", () => {
    expect(
      buildClaudeToolInvocation("WebFetch", { url: "https://example.com" }, WITHOUT_DIFFS),
    ).toMatchObject({ target: "https://example.com", targetKind: "url" });
    expect(
      buildClaudeToolInvocation("WebSearch", { query: "effect ts" }, WITHOUT_DIFFS),
    ).toMatchObject({ target: "effect ts", targetKind: "text" });
  });

  it("falls back to the first string input for unknown tools", () => {
    expect(
      buildClaudeToolInvocation("mcp__ctx__lookup", { thing: "value" }, WITHOUT_DIFFS),
    ).toMatchObject({ name: "mcp__ctx__lookup", target: "value", targetKind: "text" });
  });

  it("emits a name with no target when nothing matches", () => {
    const invocation = buildClaudeToolInvocation("Read", { offset: 3 }, WITHOUT_DIFFS);
    expect(invocation).toEqual({ name: "Read" });
  });

  it("returns undefined for a blank tool name", () => {
    expect(buildClaudeToolInvocation("  ", { file_path: "/a" }, WITHOUT_DIFFS)).toBeUndefined();
  });

  it("collapses and clamps an over-long target", () => {
    const invocation = buildClaudeToolInvocation(
      "Bash",
      { command: `echo\n${"x".repeat(400)}` },
      WITHOUT_DIFFS,
    );
    expect(invocation?.target).toHaveLength(200);
    expect(invocation?.target?.endsWith("…")).toBe(true);
    expect(invocation?.target).not.toContain("\n");
  });
});

describe("buildClaudeToolInvocation — diffs", () => {
  it("omits changes entirely when includeDiffs is false", () => {
    const invocation = buildClaudeToolInvocation(
      "Edit",
      { file_path: "/a.ts", old_string: "one", new_string: "two" },
      WITHOUT_DIFFS,
    );
    expect(invocation?.changes).toBeUndefined();
  });

  it("builds an update hunk for Edit, trimming shared context", () => {
    const invocation = buildClaudeToolInvocation(
      "Edit",
      {
        file_path: "/a.ts",
        old_string: "keep\nold line\ntail",
        new_string: "keep\nnew line\ntail",
      },
      WITH_DIFFS,
    );
    const change = invocation?.changes?.[0];
    expect(change?.path).toBe("/a.ts");
    expect(change?.kind).toBe("update");
    expect(change?.diff).toContain("-old line");
    expect(change?.diff).toContain("+new line");
    // Shared head/tail become context, not +/- lines.
    expect(change?.diff).toContain(" keep");
    expect(change?.diff).not.toContain("-keep");
  });

  it("builds an all-additions hunk for Write", () => {
    const invocation = buildClaudeToolInvocation(
      "Write",
      { file_path: "/new.ts", content: "line one\nline two" },
      WITH_DIFFS,
    );
    const change = invocation?.changes?.[0];
    expect(change?.kind).toBe("add");
    expect(change?.diff).toBe("@@ -0,0 +1,2 @@\n+line one\n+line two");
  });

  it("emits no diff when an edit changed nothing", () => {
    const invocation = buildClaudeToolInvocation(
      "Edit",
      { file_path: "/a.ts", old_string: "same", new_string: "same" },
      WITH_DIFFS,
    );
    expect(invocation?.changes?.[0]).toEqual({ path: "/a.ts", kind: "update" });
  });

  it("groups MultiEdit hunks per file", () => {
    const invocation = buildClaudeToolInvocation(
      "MultiEdit",
      {
        file_path: "/a.ts",
        edits: [
          { old_string: "a1", new_string: "b1" },
          { old_string: "a2", new_string: "b2" },
          { file_path: "/other.ts", old_string: "c", new_string: "d" },
        ],
      },
      WITH_DIFFS,
    );
    expect(invocation?.changes).toHaveLength(2);
    const [first, second] = invocation?.changes ?? [];
    expect(first?.path).toBe("/a.ts");
    expect(first?.diff).toContain("-a1");
    expect(first?.diff).toContain("-a2");
    expect(second?.path).toBe("/other.ts");
  });

  it("keeps a multi-hundred-line write intact", () => {
    const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const invocation = buildClaudeToolInvocation(
      "Write",
      { file_path: "/big.ts", content: long },
      WITH_DIFFS,
    );
    const change = invocation?.changes?.[0];
    expect(change?.diffTruncated).toBeUndefined();
    expect(change?.diff).toContain("line 199");
  });

  it("marks diffTruncated past the per-hunk line cap", () => {
    const long = Array.from({ length: 2_000 }, (_, i) => `line ${i}`).join("\n");
    const invocation = buildClaudeToolInvocation(
      "Write",
      { file_path: "/big.ts", content: long },
      WITH_DIFFS,
    );
    const change = invocation?.changes?.[0];
    expect(change?.diffTruncated).toBe(true);
    expect(change?.diff?.split("\n").length).toBeLessThanOrEqual(1_000);
  });

  it("numbers the gutter from the file when the result carries a structuredPatch", () => {
    const invocation = buildClaudeToolInvocation(
      "Edit",
      { file_path: "/a.ts", old_string: "old line", new_string: "new line" },
      {
        includeDiffs: true,
        result: {
          structuredPatch: [
            {
              oldStart: 82,
              oldLines: 3,
              newStart: 82,
              newLines: 3,
              lines: [" setError(null)", "-old line", "+new line", " try {"],
            },
          ],
        },
      },
    );
    expect(invocation?.changes?.[0]?.diff).toBe(
      "@@ -82,3 +82,3 @@\n setError(null)\n-old line\n+new line\n try {",
    );
  });

  it("re-emits every structuredPatch hunk", () => {
    const invocation = buildClaudeToolInvocation(
      "Write",
      { file_path: "/a.ts", content: "irrelevant" },
      {
        includeDiffs: true,
        result: {
          type: "update",
          structuredPatch: [
            { oldStart: 4, oldLines: 1, newStart: 4, newLines: 1, lines: ["-a", "+b"] },
            { oldStart: 90, oldLines: 1, newStart: 90, newLines: 1, lines: ["-c", "+d"] },
          ],
        },
      },
    );
    // A `Write` over an existing file is an update, not a whole-file addition.
    expect(invocation?.changes?.[0]?.kind).toBe("update");
    expect(invocation?.changes?.[0]?.diff).toBe(
      "@@ -4,1 +4,1 @@\n-a\n+b\n@@ -90,1 +90,1 @@\n-c\n+d",
    );
  });

  it("still treats a Write that created the file as an addition", () => {
    const invocation = buildClaudeToolInvocation(
      "Write",
      { file_path: "/new.ts", content: "line one" },
      { includeDiffs: true, result: { type: "create", originalFile: null } },
    );
    expect(invocation?.changes?.[0]?.kind).toBe("add");
    expect(invocation?.changes?.[0]?.diff).toBe("@@ -0,0 +1,1 @@\n+line one");
  });

  it("anchors a synthesized hunk to originalFile when there is no structuredPatch", () => {
    const originalFile = ["one", "two", "three", "four", "five", "six", "seven"].join("\n");
    const invocation = buildClaudeToolInvocation(
      "Edit",
      { file_path: "/a.ts", old_string: "five", new_string: "FIVE" },
      { includeDiffs: true, result: { originalFile } },
    );
    // `five` is line 5 of the file; the hunk is numbered from there rather than 1.
    expect(invocation?.changes?.[0]?.diff).toBe("@@ -5,1 +5,1 @@\n-five\n+FIVE");
  });

  it("declines to anchor an ambiguous or mid-line match", () => {
    for (const originalFile of ["a\ndup\nb\ndup\nc", "prefix dup\n"]) {
      const invocation = buildClaudeToolInvocation(
        "Edit",
        { file_path: "/a.ts", old_string: "dup", new_string: "DUP" },
        { includeDiffs: true, result: { originalFile } },
      );
      expect(invocation?.changes?.[0]?.diff?.split("\n")[0]).toBe("@@ -1,1 +1,1 @@");
    }
  });

  it("falls back to region-relative numbering with no result at all", () => {
    const invocation = buildClaudeToolInvocation(
      "Edit",
      { file_path: "/a.ts", old_string: "keep\nold", new_string: "keep\nnew" },
      WITH_DIFFS,
    );
    expect(invocation?.changes?.[0]?.diff?.split("\n")[0]).toBe("@@ -1,2 +1,2 @@");
  });

  it("ignores a malformed structuredPatch rather than emitting a broken hunk", () => {
    const invocation = buildClaudeToolInvocation(
      "Edit",
      { file_path: "/a.ts", old_string: "old", new_string: "new" },
      { includeDiffs: true, result: { structuredPatch: [{ oldStart: "nope", lines: ["-old"] }] } },
    );
    expect(invocation?.changes?.[0]?.diff).toBe("@@ -1,1 +1,1 @@\n-old\n+new");
  });

  it("ships captured Bash output, stdout before stderr", () => {
    const invocation = buildClaudeToolInvocation(
      "Bash",
      { command: "pnpm test" },
      { includeDiffs: true, result: { stdout: "3 passed\n", stderr: "warning: slow\n" } },
    );
    expect(invocation?.output).toBe("3 passed\nwarning: slow");
    expect(invocation?.outputTruncated).toBeUndefined();
  });

  it("omits output for a command that printed nothing", () => {
    const invocation = buildClaudeToolInvocation(
      "Bash",
      { command: "true" },
      { includeDiffs: true, result: { stdout: "", stderr: "   " } },
    );
    expect(invocation?.output).toBeUndefined();
  });

  it("caps long Bash output and flags the truncation", () => {
    const invocation = buildClaudeToolInvocation(
      "Bash",
      { command: "cat big.log" },
      {
        includeDiffs: true,
        result: { stdout: Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n") },
      },
    );
    expect(invocation?.outputTruncated).toBe(true);
    expect(invocation?.output?.split("\n").length).toBeLessThanOrEqual(40);
    expect(invocation?.output?.length).toBeLessThanOrEqual(2_000);
  });

  it("withholds output on streaming updates, like diffs", () => {
    const invocation = buildClaudeToolInvocation(
      "Bash",
      { command: "pnpm test" },
      { includeDiffs: false, result: { stdout: "3 passed" } },
    );
    expect(invocation?.output).toBeUndefined();
  });

  it("does not attach output to non-command tools", () => {
    const invocation = buildClaudeToolInvocation(
      "Read",
      { file_path: "/a.ts" },
      { includeDiffs: true, result: { stdout: "not a command result" } },
    );
    expect(invocation?.output).toBeUndefined();
  });

  it("drops diffs but keeps paths past the total payload budget", () => {
    // Many files, each with a diff that fits its own cap but not the total.
    const edits = Array.from({ length: 8 }, (_, i) => ({
      file_path: `/file${i}.ts`,
      old_string: Array.from({ length: 150 }, (_, n) => `old ${i} ${n} ${"pad".repeat(20)}`).join(
        "\n",
      ),
      new_string: Array.from({ length: 150 }, (_, n) => `new ${i} ${n} ${"pad".repeat(20)}`).join(
        "\n",
      ),
    }));
    const invocation = buildClaudeToolInvocation("MultiEdit", { edits }, WITH_DIFFS);
    expect(invocation?.changes).toHaveLength(8);
    for (const change of invocation?.changes ?? []) {
      expect(change.diff).toBeUndefined();
      expect(change.diffTruncated).toBe(true);
      expect(change.path).toMatch(/^\/file\d\.ts$/);
    }
  });
});
