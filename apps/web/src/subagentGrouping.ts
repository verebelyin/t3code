import type { WorkLogEntry } from "./session-logic";

/**
 * Nest a subagent's tool calls under the row that spawned them.
 *
 * A subagent routinely runs a dozen or more tools. Listed flat they read as the
 * main agent's own work and bury it by sheer volume, so they are collected onto
 * their parent and the row decides whether to show them.
 *
 * @module subagentGrouping
 */
export interface SubagentGroupedEntry {
  readonly entry: WorkLogEntry;
  /** Tool calls this row's subagent made, in arrival order. Empty for ordinary rows. */
  readonly children: ReadonlyArray<WorkLogEntry>;
}

/**
 * Group `entries` into parents and their subagent children, preserving order.
 *
 * An entry whose parent is not in this set stays at the top level rather than
 * disappearing — work groups are cut on message boundaries, so a subagent's
 * calls can outlive the group its `Agent(...)` row landed in, and dropping them
 * would silently lose rows.
 */
export function groupSubagentEntries(
  entries: ReadonlyArray<WorkLogEntry>,
): ReadonlyArray<SubagentGroupedEntry> {
  const parentIds = new Set<string>();
  for (const entry of entries) {
    if (entry.providerItemId !== undefined) {
      parentIds.add(entry.providerItemId);
    }
  }

  /**
   * A row is a child when it names a parent present here, and that parent is
   * not itself. Self-parenting should never happen, but treating it as a child
   * would drop the row from the log entirely — it would be skipped at the top
   * level and then attached to nothing.
   */
  const isChild = (entry: WorkLogEntry): entry is WorkLogEntry & { parentToolCallId: string } =>
    entry.parentToolCallId !== undefined &&
    parentIds.has(entry.parentToolCallId) &&
    entry.parentToolCallId !== entry.providerItemId;

  const hasAttachableChild = entries.some(isChild);
  if (!hasAttachableChild) {
    // Overwhelmingly the common case — skip building the index entirely.
    return entries.map((entry) => ({ entry, children: [] }));
  }

  const childrenByParent = new Map<string, WorkLogEntry[]>();
  for (const entry of entries) {
    if (!isChild(entry)) {
      continue;
    }
    const bucket = childrenByParent.get(entry.parentToolCallId);
    if (bucket) {
      bucket.push(entry);
    } else {
      childrenByParent.set(entry.parentToolCallId, [entry]);
    }
  }

  const grouped: SubagentGroupedEntry[] = [];
  for (const entry of entries) {
    if (isChild(entry)) {
      continue;
    }
    const children = entry.providerItemId ? (childrenByParent.get(entry.providerItemId) ?? []) : [];
    grouped.push({ entry, children });
  }
  return grouped;
}
