import { describe, expect, it } from "vite-plus/test";

import type { WorkLogEntry } from "./session-logic";
import { groupSubagentEntries } from "./subagentGrouping";

const entry = (id: string, extra: Partial<WorkLogEntry> = {}): WorkLogEntry => ({
  id,
  createdAt: "2026-08-02T00:00:00.000Z",
  label: id,
  tone: "tool",
  ...extra,
});

describe("groupSubagentEntries", () => {
  it("collects a subagent's calls onto the row that spawned them", () => {
    const grouped = groupSubagentEntries([
      entry("agent", { providerItemId: "toolu_task" }),
      entry("read", { parentToolCallId: "toolu_task" }),
      entry("bash", { parentToolCallId: "toolu_task" }),
      entry("main"),
    ]);

    expect(grouped.map((g) => g.entry.id)).toEqual(["agent", "main"]);
    expect(grouped[0]?.children.map((c) => c.id)).toEqual(["read", "bash"]);
    expect(grouped[1]?.children).toEqual([]);
  });

  it("keeps parallel subagents separate", () => {
    const grouped = groupSubagentEntries([
      entry("agent-a", { providerItemId: "a" }),
      entry("agent-b", { providerItemId: "b" }),
      entry("a1", { parentToolCallId: "a" }),
      entry("b1", { parentToolCallId: "b" }),
      entry("a2", { parentToolCallId: "a" }),
    ]);

    expect(grouped.map((g) => g.entry.id)).toEqual(["agent-a", "agent-b"]);
    expect(grouped[0]?.children.map((c) => c.id)).toEqual(["a1", "a2"]);
    expect(grouped[1]?.children.map((c) => c.id)).toEqual(["b1"]);
  });

  it("keeps an orphan at the top level rather than dropping it", () => {
    // Work groups are cut on message boundaries, so a subagent's calls can
    // outlive the group its agent row landed in. Losing rows is not an option.
    const grouped = groupSubagentEntries([
      entry("orphan", { parentToolCallId: "toolu_elsewhere" }),
      entry("main"),
    ]);

    expect(grouped.map((g) => g.entry.id)).toEqual(["orphan", "main"]);
    expect(grouped[0]?.children).toEqual([]);
  });

  it("preserves order and identity when nothing is nested", () => {
    const flat = [entry("a"), entry("b"), entry("c")];
    const grouped = groupSubagentEntries(flat);

    expect(grouped.map((g) => g.entry)).toEqual(flat);
    expect(grouped.every((g) => g.children.length === 0)).toBe(true);
  });

  it("does not nest a row under itself", () => {
    // Degenerate, but treating it as its own child would skip it at the top
    // level and attach it to nothing, losing the row from the log.
    const grouped = groupSubagentEntries([
      entry("self", { providerItemId: "x", parentToolCallId: "x" }),
    ]);
    expect(grouped.map((g) => g.entry.id)).toEqual(["self"]);
    expect(grouped[0]?.children).toEqual([]);
  });

  it("never loses a row, whatever the linkage", () => {
    const entries = [
      entry("agent", { providerItemId: "a" }),
      entry("child", { parentToolCallId: "a" }),
      entry("orphan", { parentToolCallId: "missing" }),
      entry("self", { providerItemId: "s", parentToolCallId: "s" }),
      entry("plain"),
    ];
    const grouped = groupSubagentEntries(entries);
    const seen = grouped.flatMap((g) => [g.entry.id, ...g.children.map((c) => c.id)]);

    expect(seen.toSorted()).toEqual(entries.map((e) => e.id).toSorted());
  });

  it("handles an empty group", () => {
    expect(groupSubagentEntries([])).toEqual([]);
  });
});
