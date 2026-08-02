/**
 * Builds a canonical {@link ToolInvocation} from a Codex thread item.
 *
 * Mirrors `claudeToolInvocation.ts`. Codex is the richer side of the pair: its
 * `fileChange` items already carry a real per-file unified diff, so this mostly
 * reshapes and caps rather than synthesizing one.
 *
 * Extracted from `CodexAdapter.ts` so the mapping is testable without standing
 * up the Effect session runtime. The item is accepted as a plain record rather
 * than a generated Codex schema type to keep this module dependency-free.
 *
 * @module provider/Layers/codexToolInvocation
 */
import type { CanonicalItemType, ToolInvocation, ToolInvocationChange } from "@t3tools/contracts";

const MAX_TARGET_CHARS = 200;
const MAX_CHANGES = 8;
const MAX_DIFF_LINES = 40;
const MAX_DIFF_CHARS = 2_000;
const MAX_CHANGES_JSON_BYTES = 8_192;

function clampTarget(value: string): string {
  const collapsed = value.replaceAll(/\s+/g, " ").trim();
  return collapsed.length <= MAX_TARGET_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_TARGET_CHARS - 1)}…`;
}

/**
 * Codex ships a complete patch per file; Claude synthesizes a bare hunk. Strip
 * the file headers so both providers hand the client the same shape, and the
 * client can re-add headers using the relative path it is about to display.
 */
export function stripFileHeaders(diff: string): string {
  const lines = diff.split(/\r?\n/);
  let start = 0;
  while (start < lines.length) {
    const line = lines[start] ?? "";
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ")
    ) {
      start += 1;
      continue;
    }
    break;
  }
  return lines.slice(start).join("\n").trim();
}

function capDiff(diff: string): { diff: string; truncated: boolean } {
  let truncated = false;
  let lines = diff.split("\n");
  if (lines.length > MAX_DIFF_LINES) {
    lines = lines.slice(0, MAX_DIFF_LINES);
    truncated = true;
  }
  let capped = lines.join("\n");
  if (capped.length > MAX_DIFF_CHARS) {
    const clipped = capped.slice(0, MAX_DIFF_CHARS);
    const lastNewline = clipped.lastIndexOf("\n");
    capped = lastNewline > 0 ? clipped.slice(0, lastNewline) : clipped;
    truncated = true;
  }
  return { diff: capped, truncated };
}

function toChangeKind(kind: unknown): ToolInvocationChange["kind"] {
  const normalized = typeof kind === "string" ? kind.toLowerCase() : "";
  if (normalized.includes("add") || normalized.includes("create")) return "add";
  if (normalized.includes("delete") || normalized.includes("remove")) return "delete";
  return "update";
}

export interface BuildCodexToolInvocationOptions {
  /** Attach `changes[].diff`. False before the item is final. */
  readonly includeDiffs: boolean;
  /** Pre-computed item detail, used as the target for search items. */
  readonly detail?: string | undefined;
}

/**
 * Map a Codex thread item onto the canonical invocation shape, so Codex rows
 * read the same as Claude's (`Bash(...)`, `Edit(...)`).
 *
 * Returns `undefined` for item types with no meaningful named form; those rows
 * keep their existing generic rendering.
 */
export function buildCodexToolInvocation(
  itemType: CanonicalItemType,
  item: Record<string, unknown>,
  options: BuildCodexToolInvocationOptions,
): ToolInvocation | undefined {
  switch (itemType) {
    case "command_execution": {
      const command = typeof item.command === "string" ? item.command : undefined;
      return {
        name: "Bash",
        ...(command ? { target: clampTarget(command), targetKind: "command" as const } : {}),
      };
    }
    case "file_change": {
      const rawChanges = Array.isArray(item.changes) ? item.changes : [];
      const changes: ToolInvocationChange[] = [];
      for (const rawChange of rawChanges.slice(0, MAX_CHANGES)) {
        if (typeof rawChange !== "object" || rawChange === null) continue;
        const change = rawChange as Record<string, unknown>;
        const path = typeof change.path === "string" ? change.path.trim() : "";
        if (path.length === 0) continue;
        const kind = toChangeKind(change.kind);
        if (!options.includeDiffs || typeof change.diff !== "string") {
          changes.push({ path, kind });
          continue;
        }
        const stripped = stripFileHeaders(change.diff);
        if (stripped.length === 0) {
          changes.push({ path, kind });
          continue;
        }
        const capped = capDiff(stripped);
        changes.push({
          path,
          kind,
          diff: capped.diff,
          ...(capped.truncated ? { diffTruncated: true } : {}),
        });
      }
      const budgeted =
        JSON.stringify(changes).length > MAX_CHANGES_JSON_BYTES
          ? changes.map((change) => ({
              path: change.path,
              ...(change.kind ? { kind: change.kind } : {}),
              diffTruncated: true as const,
            }))
          : changes;
      const first = budgeted[0];
      return {
        name: "Edit",
        ...(first ? { target: clampTarget(first.path), targetKind: "path" as const } : {}),
        ...(budgeted.length > 0 ? { changes: budgeted } : {}),
      };
    }
    case "web_search": {
      return {
        name: "WebSearch",
        ...(options.detail
          ? { target: clampTarget(options.detail), targetKind: "text" as const }
          : {}),
      };
    }
    case "mcp_tool_call": {
      const server = typeof item.server === "string" ? item.server : undefined;
      const tool = typeof item.tool === "string" ? item.tool : undefined;
      const name = server && tool ? `${server}:${tool}` : (tool ?? server);
      return name ? { name } : undefined;
    }
    default:
      return undefined;
  }
}
