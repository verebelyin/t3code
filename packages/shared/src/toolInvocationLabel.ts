/**
 * Display formatting for provider tool invocations.
 *
 * Turns a `ToolInvocation` (see `@t3tools/contracts` → `providerRuntime.ts`)
 * into the `Read(src/foo.ts)` label shown on a chat timeline row.
 *
 * Lives in `@t3tools/shared` rather than the web app so mobile can adopt it
 * without a third copy of the mapping. Keep this module free of DOM/React and
 * of any path resolution — callers format `path`-kind targets themselves,
 * because "workspace-relative" means different things per surface.
 *
 * @module toolInvocationLabel
 */

export type ToolInvocationTargetKind = "path" | "pattern" | "command" | "agent" | "url" | "text";

/**
 * Non-Claude tool identifiers that should render under a Claude-equivalent
 * name, so one thread reads consistently regardless of which provider ran it.
 *
 * Keys are compared lowercased with separators stripped, so `commandExecution`,
 * `command_execution` and `command execution` all collapse to one entry.
 */
const CANONICAL_TOOL_NAMES: ReadonlyMap<string, string> = new Map([
  // Codex canonical item types.
  ["commandexecution", "Bash"],
  ["filechange", "Edit"],
  ["websearch", "WebSearch"],
  ["imageview", "Read"],
  // ACP tool kinds (Cursor, Grok, OpenCode).
  ["read", "Read"],
  ["edit", "Edit"],
  ["execute", "Bash"],
  ["search", "Grep"],
  ["fetch", "WebFetch"],
  ["delete", "Delete"],
  ["move", "Move"],
  ["think", "Think"],
]);

const MCP_TOOL_PREFIX = "mcp__";

function normalizeLookupKey(value: string): string {
  return value.replaceAll(/[\s_-]/g, "").toLowerCase();
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Normalize a provider-native tool name into the verb shown to the user.
 *
 * Claude's own names (`Read`, `Edit`, `Bash`, `Task`, …) already read well and
 * pass through unchanged — they are the vocabulary the other providers are
 * mapped onto.
 */
export function toolDisplayName(rawName: string): string {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return "";
  }

  // `mcp__<server>__<tool>` → `<server>:<tool>`. Server and tool names are
  // author-controlled, so they are shown as written rather than title-cased.
  if (trimmed.toLowerCase().startsWith(MCP_TOOL_PREFIX)) {
    const [server, ...toolParts] = trimmed.slice(MCP_TOOL_PREFIX.length).split("__");
    const tool = toolParts.join("__");
    if (server && tool) {
      return `${server}:${tool}`;
    }
    return server || trimmed;
  }

  const canonical = CANONICAL_TOOL_NAMES.get(normalizeLookupKey(trimmed));
  if (canonical) {
    return canonical;
  }

  return titleCase(trimmed);
}

/**
 * Collapse a target to a single line for display in the row heading.
 *
 * Commands and patterns routinely contain newlines; a row is single-line by
 * construction, so an un-collapsed value would silently blow out row height
 * measurement on surfaces that assume fixed rows.
 */
export function collapseTargetWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

export interface ToolInvocationLabelInput {
  readonly name: string;
  readonly target?: string | undefined;
  readonly targetKind?: ToolInvocationTargetKind | undefined;
}

/**
 * Build the row label: `Read(src/foo.ts)`, `Bash(pnpm test run)`, `Task(Explore)`.
 *
 * Returns the bare verb when there is no target, so an unrecognised tool still
 * renders as a name rather than an empty pair of parentheses.
 *
 * `path`-kind targets are expected to be pre-formatted by the caller (the
 * relative-path rules differ per surface); this function does not touch them.
 */
export function formatToolInvocationLabel(input: ToolInvocationLabelInput): string {
  const name = toolDisplayName(input.name);
  if (name.length === 0) {
    return "";
  }
  const target = input.target === undefined ? "" : collapseTargetWhitespace(input.target);
  return target.length === 0 ? name : `${name}(${target})`;
}
