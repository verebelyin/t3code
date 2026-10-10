import { describe, expect, it } from "vite-plus/test";

import type { AcpToolCallState } from "@t3tools/provider-acp/server/runtimeModel";
import { makeCommandCodeLoopGuard } from "./CommandCodeLoopGuard.ts";

let nextId = 0;
const completed = (command: string, output = "(no output)"): AcpToolCallState => ({
  toolCallId: `call_${nextId++}`,
  kind: "execute",
  title: "Ran command",
  status: "completed",
  command,
  data: {
    rawInput: { command, description: "noop" },
    content: [{ type: "content", content: { type: "text", text: output } }],
  },
});

describe("makeCommandCodeLoopGuard", () => {
  it("flags the same completed call repeated to the threshold", () => {
    const guard = makeCommandCodeLoopGuard(3);
    expect(guard.observe(completed("true"))).toBeUndefined();
    expect(guard.observe(completed("true"))).toBeUndefined();
    expect(guard.observe(completed("true"))).toContain("3 times in a row (true)");
  });

  it("resets when a different call or different output interrupts", () => {
    const guard = makeCommandCodeLoopGuard(3);
    guard.observe(completed("true"));
    guard.observe(completed("true"));
    guard.observe(completed("ls"));
    expect(guard.observe(completed("true"))).toBeUndefined();
    expect(guard.observe(completed("true", "changed"))).toBeUndefined();
    expect(guard.observe(completed("true", "changed"))).toBeUndefined();
  });

  it("ignores in-progress updates and repeats of one tool call id", () => {
    const guard = makeCommandCodeLoopGuard(2);
    const call = completed("true");
    expect(guard.observe({ ...call, status: "inProgress" })).toBeUndefined();
    expect(guard.observe(call)).toBeUndefined();
    expect(guard.observe(call)).toBeUndefined();
    expect(guard.observe(completed("true"))).toBeDefined();
  });

  it("starts fresh after reset", () => {
    const guard = makeCommandCodeLoopGuard(2);
    guard.observe(completed("true"));
    guard.reset();
    expect(guard.observe(completed("true"))).toBeUndefined();
  });
});
