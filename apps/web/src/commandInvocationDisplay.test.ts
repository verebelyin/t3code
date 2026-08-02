import { describe, expect, it } from "vite-plus/test";

import { buildCommandInvocationView } from "./commandInvocationDisplay";

describe("buildCommandInvocationView", () => {
  it("splits a command run into command, output, and status", () => {
    const view = buildCommandInvocationView({
      itemType: "command_execution",
      command: "bun run dev",
      detail: '{ "dev": "vite dev --port 3000" }',
      exitCode: 0,
    });
    expect(view).toEqual({
      command: "bun run dev",
      output: '{ "dev": "vite dev --port 3000" }',
      outputTruncated: false,
      exitCode: 0,
      failed: false,
    });
  });

  it("flags a non-zero exit as failed", () => {
    expect(
      buildCommandInvocationView({
        itemType: "command_execution",
        command: "pnpm test",
        detail: "1 failing",
        exitCode: 1,
      })?.failed,
    ).toBe(true);
  });

  it("treats a missing exit code as neither passed nor failed", () => {
    const view = buildCommandInvocationView({
      itemType: "command_execution",
      command: "echo hi",
      detail: "hi",
    });
    expect(view?.exitCode).toBeUndefined();
    expect(view?.failed).toBe(false);
  });

  it("prefers rawCommand so a multi-line script is not collapsed", () => {
    expect(
      buildCommandInvocationView({
        itemType: "command_execution",
        command: "cat <<EOF > a.txt one two EOF",
        rawCommand: "cat <<EOF > a.txt\none\ntwo\nEOF",
      })?.command,
    ).toBe("cat <<EOF > a.txt\none\ntwo\nEOF");
  });

  it("reports no output rather than an empty string", () => {
    expect(
      buildCommandInvocationView({
        itemType: "command_execution",
        command: "true",
        detail: "   ",
        exitCode: 0,
      })?.output,
    ).toBeNull();
  });

  it("recognises a command row by its invocation target kind", () => {
    expect(
      buildCommandInvocationView({
        toolInvocation: { name: "Bash", target: "ls -la", targetKind: "command" },
        command: "ls -la",
      })?.command,
    ).toBe("ls -la");
  });

  it("prefers the adapter's captured output over detail", () => {
    expect(
      buildCommandInvocationView({
        itemType: "command_execution",
        command: "pnpm test",
        detail: "a stale one-line summary",
        toolInvocation: { name: "Bash", output: "3 passed\n1 failed" },
      })?.output,
    ).toBe("3 passed\n1 failed");
  });

  it("surfaces the truncation flag from the invocation", () => {
    expect(
      buildCommandInvocationView({
        itemType: "command_execution",
        command: "cat big.log",
        toolInvocation: { name: "Bash", output: "line 1", outputTruncated: true },
      })?.outputTruncated,
    ).toBe(true);
  });

  it("ignores a detail that merely restates the command", () => {
    // Claude puts the request summary in `detail`; echoing it under the prompt
    // line would read as output the command never produced.
    for (const detail of ["pnpm test", "Bash: pnpm test", "  PNPM   TEST  "]) {
      expect(
        buildCommandInvocationView({
          itemType: "command_execution",
          command: "pnpm test",
          detail,
        })?.output,
      ).toBeNull();
    }
  });

  it("still uses detail when it carries real output", () => {
    expect(
      buildCommandInvocationView({
        itemType: "command_execution",
        command: "pnpm test",
        detail: "3 passed",
      })?.output,
    ).toBe("3 passed");
  });

  it("falls back to the invocation exit code", () => {
    const view = buildCommandInvocationView({
      itemType: "command_execution",
      command: "pnpm test",
      toolInvocation: { name: "Bash", exitCode: 1 },
    });
    expect(view?.exitCode).toBe(1);
    expect(view?.failed).toBe(true);
  });

  it("returns null for a non-command row, so it keeps its plain body", () => {
    expect(
      buildCommandInvocationView({
        itemType: "file_change",
        command: "ls",
      }),
    ).toBeNull();
  });

  it("returns null when there is no command to show", () => {
    expect(
      buildCommandInvocationView({ itemType: "command_execution", detail: "output only" }),
    ).toBeNull();
  });
});
