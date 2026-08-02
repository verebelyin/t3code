/**
 * Builds a canonical {@link ToolInvocation} from a Claude Agent SDK `tool_use`
 * block, so the client can render `Read(src/foo.ts)` instead of a generic row.
 *
 * Kept out of `ClaudeAdapter.ts` because it is pure and worth testing directly:
 * the adapter is a large Effect module and this is a plain data mapping.
 *
 * Every cap lives here rather than at the WS boundary. The adapter is the only
 * layer that knows a diff is a diff and a command is a command, so it is the
 * only layer that can truncate meaningfully — and per AGENTS.md, oversized
 * WebSocket payloads are a known source of performance regressions.
 *
 * @module provider/Layers/claudeToolInvocation
 */
import type {
  ToolInvocation,
  ToolInvocationChange,
  ToolInvocationTargetKind,
} from "@t3tools/contracts";

import {
  buildAdditionHunk,
  buildStructuredPatchHunks,
  buildUnifiedHunk,
  findHunkAnchor,
  type HunkAnchor,
  type UnifiedHunkOptions,
  type UnifiedHunkResult,
} from "../unifiedHunk.ts";

/** Caps. See the module docstring for why they live here. */
const MAX_NAME_CHARS = 64;
const MAX_TARGET_CHARS = 200;
const MAX_CHANGES = 8;
const MAX_MULTI_EDIT_HUNKS_PER_FILE = 3;
const HUNK_OPTIONS: UnifiedHunkOptions = { maxLines: 40, maxChars: 2_000 };
/**
 * Total budget for the serialized `changes` array. Past this, diffs are dropped
 * wholesale and only paths survive — a row that names its files is far more
 * useful than one that blows out the socket.
 */
const MAX_CHANGES_JSON_BYTES = 8_192;
/**
 * Command-output budget, matching the per-hunk diff cap.
 *
 * A `Bash` row is not a terminal emulator: it exists so the reader can see what
 * happened without opening the transcript. Truncation keeps the head rather than
 * the tail because that is where a command announces what it is doing; a run
 * whose tail matters is already flagged by the row's failure indicator.
 */
const MAX_OUTPUT_LINES = 40;
const MAX_OUTPUT_CHARS = 2_000;

interface TargetSpec {
  readonly keys: ReadonlyArray<string>;
  readonly kind: ToolInvocationTargetKind;
}

/**
 * Which input key holds "the thing in the parentheses", per tool.
 *
 * Keyed by lowercased tool name. Unlisted tools still get a name-only
 * invocation, which renders as a bare verb rather than falling back to the
 * generic row.
 */
const TARGET_BY_TOOL: ReadonlyMap<string, TargetSpec> = new Map([
  ["read", { keys: ["file_path"], kind: "path" }],
  ["write", { keys: ["file_path"], kind: "path" }],
  ["edit", { keys: ["file_path"], kind: "path" }],
  ["multiedit", { keys: ["file_path"], kind: "path" }],
  ["notebookedit", { keys: ["notebook_path", "file_path"], kind: "path" }],
  ["grep", { keys: ["pattern"], kind: "pattern" }],
  ["glob", { keys: ["pattern"], kind: "pattern" }],
  ["bash", { keys: ["command"], kind: "command" }],
  ["task", { keys: ["description", "subagent_type"], kind: "agent" }],
  ["webfetch", { keys: ["url"], kind: "url" }],
  ["websearch", { keys: ["query"], kind: "text" }],
]);

function normalizeToolKey(toolName: string): string {
  return toolName.replaceAll(/[\s_-]/g, "").toLowerCase();
}

function readString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function clamp(value: string, maxChars: number): string {
  const collapsed = value.replaceAll(/\s+/g, " ").trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars - 1)}…`;
}

function resolveTarget(
  toolName: string,
  input: Record<string, unknown>,
): { target: string; targetKind: ToolInvocationTargetKind } | undefined {
  const spec = TARGET_BY_TOOL.get(normalizeToolKey(toolName));
  if (spec) {
    for (const key of spec.keys) {
      const value = readString(input, key);
      if (value !== undefined) {
        return { target: clamp(value, MAX_TARGET_CHARS), targetKind: spec.kind };
      }
    }
    return undefined;
  }

  // Unknown tool (including MCP): fall back to the first string-ish input, which
  // is usually the interesting one. Better a rough target than none.
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim().length > 0) {
      return { target: clamp(value, MAX_TARGET_CHARS), targetKind: "text" };
    }
  }
  return undefined;
}

/**
 * The `originalFile` the SDK echoes back alongside an edit, when it has one.
 *
 * Only useful for anchoring a synthesized hunk to a real line number; `Edit`
 * reports `null` here for a file it could not read.
 */
function readOriginalFile(result: Record<string, unknown> | undefined): string | undefined {
  const value = result?.originalFile ?? result?.original_file;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Best available anchor for a hunk synthesized from `oldText`.
 *
 * `undefined` means "number from the region", which is what the gutter fell back
 * to for every edit before the tool result was consulted.
 */
function anchorFor(
  result: Record<string, unknown> | undefined,
  oldText: string,
): HunkAnchor | undefined {
  const originalFile = readOriginalFile(result);
  return originalFile === undefined ? undefined : findHunkAnchor(originalFile, oldText);
}

function toChange(
  path: string,
  kind: ToolInvocationChange["kind"],
  hunk: UnifiedHunkResult | undefined,
): ToolInvocationChange {
  if (!hunk) {
    return { path, kind };
  }
  return {
    path,
    kind,
    diff: hunk.diff,
    ...(hunk.truncated ? { diffTruncated: true } : {}),
  };
}

function buildEditChange(
  input: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
): ToolInvocationChange | undefined {
  const path = readString(input, "file_path") ?? readString(input, "notebook_path");
  if (path === undefined) {
    return undefined;
  }
  const oldText = readString(input, "old_string") ?? readString(input, "old_source") ?? "";
  const newText = readString(input, "new_string") ?? readString(input, "new_source") ?? "";
  // The SDK's own patch first: it was computed against the file on disk, so its
  // line numbers are the file's. Synthesis can only guess at them.
  const hunk =
    buildStructuredPatchHunks(result?.structuredPatch, HUNK_OPTIONS) ??
    buildUnifiedHunk(oldText, newText, HUNK_OPTIONS, anchorFor(result, oldText));
  return toChange(path, "update", hunk);
}

function buildWriteChange(
  input: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
): ToolInvocationChange | undefined {
  const path = readString(input, "file_path");
  if (path === undefined) {
    return undefined;
  }
  // `Write` over an existing file is an update, not a fresh add — and its
  // structured patch shows only the lines that actually moved, rather than
  // painting the whole file green.
  const structured = buildStructuredPatchHunks(result?.structuredPatch, HUNK_OPTIONS);
  const kind = result?.type === "update" ? "update" : "add";
  if (structured) {
    return toChange(path, kind, structured);
  }
  const content = readString(input, "content") ?? "";
  return toChange(path, kind, buildAdditionHunk(content, HUNK_OPTIONS));
}

/**
 * `MultiEdit` carries `edits: [{ file_path?, old_string, new_string }]` against a
 * single top-level `file_path`. Group by resolved path so one file yields one
 * row entry with its hunks concatenated.
 */
function buildMultiEditChanges(input: Record<string, unknown>): ToolInvocationChange[] {
  const edits = input.edits;
  if (!Array.isArray(edits)) {
    return [];
  }
  const rootPath = readString(input, "file_path");
  const byPath = new Map<string, { hunks: string[]; truncated: boolean }>();

  for (const rawEdit of edits) {
    if (typeof rawEdit !== "object" || rawEdit === null) {
      continue;
    }
    const edit = rawEdit as Record<string, unknown>;
    const path = readString(edit, "file_path") ?? rootPath;
    if (path === undefined) {
      continue;
    }
    const entry = byPath.get(path) ?? { hunks: [], truncated: false };
    if (entry.hunks.length >= MAX_MULTI_EDIT_HUNKS_PER_FILE) {
      entry.truncated = true;
      byPath.set(path, entry);
      continue;
    }
    const hunk = buildUnifiedHunk(
      readString(edit, "old_string") ?? "",
      readString(edit, "new_string") ?? "",
      HUNK_OPTIONS,
    );
    if (hunk) {
      entry.hunks.push(hunk.diff);
      entry.truncated ||= hunk.truncated;
    }
    byPath.set(path, entry);
  }

  return [...byPath.entries()].map(([path, entry]) => ({
    path,
    kind: "update" as const,
    ...(entry.hunks.length > 0 ? { diff: entry.hunks.join("\n") } : {}),
    ...(entry.truncated ? { diffTruncated: true } : {}),
  }));
}

function buildChanges(
  toolName: string,
  input: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
): ToolInvocationChange[] {
  switch (normalizeToolKey(toolName)) {
    case "edit":
    case "notebookedit": {
      const change = buildEditChange(input, result);
      return change ? [change] : [];
    }
    case "write": {
      const change = buildWriteChange(input, result);
      return change ? [change] : [];
    }
    case "multiedit":
      return buildMultiEditChanges(input);
    default:
      return [];
  }
}

/**
 * Command output for a `Bash` call, from the SDK's `BashOutput` result.
 *
 * `stdout` and `stderr` are separate fields there but a single interleaved
 * stream to the reader, so they are concatenated in that order. Returns
 * `undefined` when the command printed nothing, which the client renders as an
 * explicit "no output" rather than an empty box.
 */
function buildCommandOutput(
  result: Record<string, unknown> | undefined,
): { output: string; truncated: boolean } | undefined {
  if (!result) {
    return undefined;
  }
  const parts: string[] = [];
  for (const key of ["stdout", "stderr"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim().length > 0) {
      parts.push(value.trimEnd());
    }
  }
  if (parts.length === 0) {
    return undefined;
  }

  let truncated = false;
  let lines = parts.join("\n").split(/\r?\n/);
  if (lines.length > MAX_OUTPUT_LINES) {
    lines = lines.slice(0, MAX_OUTPUT_LINES);
    truncated = true;
  }
  let output = lines.join("\n");
  if (output.length > MAX_OUTPUT_CHARS) {
    const clipped = output.slice(0, MAX_OUTPUT_CHARS);
    const lastNewline = clipped.lastIndexOf("\n");
    output = lastNewline > 0 ? clipped.slice(0, lastNewline) : clipped;
    truncated = true;
  }
  return { output, truncated };
}

/**
 * Enforce the total payload budget: if the serialized changes exceed it, keep
 * the paths and drop every diff.
 */
function applyTotalBudget(changes: ToolInvocationChange[]): ToolInvocationChange[] {
  const capped = changes.slice(0, MAX_CHANGES);
  if (JSON.stringify(capped).length <= MAX_CHANGES_JSON_BYTES) {
    return capped;
  }
  return capped.map((change) => ({
    path: change.path,
    ...(change.kind ? { kind: change.kind } : {}),
    diffTruncated: true,
  }));
}

export interface BuildClaudeToolInvocationOptions {
  /**
   * Whether to attach `changes[].diff` and `output`. False on streaming updates,
   * where the input fingerprint changes on every parse and re-shipping a long
   * `new_string` each time would flood the socket.
   */
  readonly includeDiffs: boolean;
  /**
   * The SDK's `tool_use_result` for this call, when it has arrived.
   *
   * Carries `structuredPatch` for `Edit`/`Write` — the only source of real file
   * line numbers, since the tool *input* says nothing about where in the file the
   * edit landed. Without it the gutter can only count from the changed region.
   */
  readonly result?: Record<string, unknown> | undefined;
}

/**
 * Map a Claude `tool_use` name plus its raw input into a canonical invocation.
 *
 * Returns `undefined` only for a blank tool name; every named tool yields at
 * least a name, so the row can render a verb.
 */
export function buildClaudeToolInvocation(
  toolName: string,
  input: Record<string, unknown>,
  options: BuildClaudeToolInvocationOptions,
): ToolInvocation | undefined {
  const name = toolName.trim();
  if (name.length === 0) {
    return undefined;
  }

  const resolved = resolveTarget(name, input);
  const changes = options.includeDiffs
    ? applyTotalBudget(buildChanges(name, input, options.result))
    : [];
  const command =
    options.includeDiffs && normalizeToolKey(name) === "bash"
      ? buildCommandOutput(options.result)
      : undefined;

  return {
    name: clamp(name, MAX_NAME_CHARS),
    ...(resolved ? { target: resolved.target, targetKind: resolved.targetKind } : {}),
    ...(changes.length > 0 ? { changes } : {}),
    ...(command ? { output: command.output } : {}),
    ...(command?.truncated ? { outputTruncated: true } : {}),
  };
}
