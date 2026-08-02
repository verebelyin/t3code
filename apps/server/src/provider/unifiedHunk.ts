/**
 * Minimal unified-diff hunk synthesis.
 *
 * Claude's `Edit`/`Write` tool inputs carry `old_string`/`new_string` but no
 * diff, and there is no patch generator in the dependency tree (`@pierre/diffs`
 * parses patches, it does not produce them). Rather than add a diff library for
 * one row in the timeline, this trims the shared head and tail of the two
 * versions and emits the changed region as a single hunk.
 *
 * Deliberately not an LCS diff: the input is already scoped to one edit, so a
 * common-prefix/suffix trim produces the same region a real differ would, at a
 * fraction of the code. Multi-region edits (`MultiEdit`) arrive as separate
 * strings and get separate hunks.
 *
 * ## Getting the gutter right
 *
 * Synthesis is the *fallback*. The tool inputs alone say nothing about where in
 * the file the edit landed, so a hunk built from them can only be numbered from
 * 1 — which renders as a gutter that looks authoritative and is wrong. Prefer,
 * in order:
 *
 * 1. {@link buildStructuredPatchHunks} — the SDK's `tool_use_result` carries a
 *    `structuredPatch` with real file offsets for `Edit` and `Write`.
 * 2. {@link buildUnifiedHunk} with a {@link HunkAnchor} derived from the result's
 *    `originalFile` via {@link findHunkAnchor}.
 * 3. {@link buildUnifiedHunk} with no anchor — region-relative, last resort.
 *
 * @module provider/unifiedHunk
 */

/**
 * Context lines retained either side of the change. Three matches `diff -u`'s
 * default and is enough to orient a reader without inflating the payload.
 */
const CONTEXT_LINES = 3;

export interface UnifiedHunkOptions {
  /** Max lines in the emitted hunk before truncation. */
  readonly maxLines: number;
  /** Max characters in the emitted hunk before truncation. */
  readonly maxChars: number;
}

export interface UnifiedHunkResult {
  /** Hunk body: an `@@` header followed by `-`/`+`/context lines. */
  readonly diff: string;
  readonly truncated: boolean;
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Where the supplied `oldText`/`newText` begin in their respective files, 1-based.
 *
 * Without one, {@link buildUnifiedHunk} numbers from line 1 and the rendered
 * gutter is region-relative rather than file-relative.
 */
export interface HunkAnchor {
  readonly oldStart: number;
  readonly newStart: number;
}

const REGION_RELATIVE_ANCHOR: HunkAnchor = { oldStart: 1, newStart: 1 };

function splitLines(value: string): string[] {
  return value.split(/\r?\n/);
}

/**
 * Locate `oldText` inside `originalFile` and report the 1-based line it starts on.
 *
 * Returns `undefined` unless the match is unique *and* starts on a line boundary.
 * A mid-line or ambiguous match cannot be numbered honestly — the first "line" of
 * the hunk would be a fragment — and a wrong gutter is worse than a relative one.
 */
export function findHunkAnchor(originalFile: string, oldText: string): HunkAnchor | undefined {
  if (oldText.length === 0) {
    return undefined;
  }
  const at = originalFile.indexOf(oldText);
  if (at < 0 || originalFile.indexOf(oldText, at + 1) >= 0) {
    return undefined;
  }
  if (at > 0 && originalFile[at - 1] !== "\n") {
    return undefined;
  }
  // Lines before the match, counting either newline style.
  const line = splitLines(originalFile.slice(0, at)).length;
  return { oldStart: line, newStart: line };
}

/**
 * Build a unified hunk describing the change from `oldText` to `newText`.
 *
 * Returns `undefined` when the two are identical — an edit that changed nothing
 * should render as a plain row, not an empty diff.
 *
 * ## Line numbers
 *
 * With an `anchor`, the `@@` header counts from the file. Without one it counts
 * from the start of the changed region, because the tool input carries no file
 * offset — and the adapter deliberately does not read the file from disk to find
 * one, since the file may have changed again by the time the event is processed.
 * Callers should supply an anchor whenever the tool result gives them the means;
 * see the module docstring.
 */
export function buildUnifiedHunk(
  oldText: string,
  newText: string,
  options: UnifiedHunkOptions,
  anchor: HunkAnchor = REGION_RELATIVE_ANCHOR,
): UnifiedHunkResult | undefined {
  if (oldText === newText) {
    return undefined;
  }

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  // Trim the shared head.
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  // Trim the shared tail, without overlapping the head.
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const contextStart = Math.max(0, prefix - CONTEXT_LINES);
  const leadingContext = oldLines.slice(contextStart, prefix);
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  const trailingContext = oldLines.slice(
    oldLines.length - suffix,
    Math.min(oldLines.length, oldLines.length - suffix + CONTEXT_LINES),
  );

  const oldCount = leadingContext.length + removed.length + trailingContext.length;
  const newCount = leadingContext.length + added.length + trailingContext.length;

  // The trimmed head is identical in both versions, so the same `contextStart`
  // offset applies to each side.
  const oldStart = anchor.oldStart + contextStart;
  const newStart = anchor.newStart + contextStart;

  const body: string[] = [
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...leadingContext.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...trailingContext.map((line) => ` ${line}`),
  ];

  return capHunk(body, removed.length, added.length, options);
}

/**
 * Re-emit the SDK's own `structuredPatch` as hunk bodies.
 *
 * `tool_use_result` for `Edit` and `Write` carries `FileEditOutput`/
 * `FileWriteOutput`, whose `structuredPatch` was computed against the file on
 * disk and therefore has real line numbers. Preferring it over synthesis is the
 * whole reason the gutter can be trusted.
 *
 * Accepts `unknown` because the SDK types `tool_use_result` as `unknown`; a
 * shape that does not match yields `undefined` so the caller falls back.
 */
export function buildStructuredPatchHunks(
  value: unknown,
  options: UnifiedHunkOptions,
): UnifiedHunkResult | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const body: string[] = [];
  let additions = 0;
  let deletions = 0;

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return undefined;
    }
    const hunk = entry as Record<string, unknown>;
    const oldStart = hunk.oldStart;
    const newStart = hunk.newStart;
    const lines = hunk.lines;
    if (
      typeof oldStart !== "number" ||
      typeof newStart !== "number" ||
      !Array.isArray(lines) ||
      !lines.every((line): line is string => typeof line === "string")
    ) {
      return undefined;
    }
    // Trust the reported counts when present, but derive them otherwise: a hunk
    // header whose counts disagree with its body renders as a broken diff.
    const oldLines =
      typeof hunk.oldLines === "number"
        ? hunk.oldLines
        : lines.filter((line) => !line.startsWith("+")).length;
    const newLines =
      typeof hunk.newLines === "number"
        ? hunk.newLines
        : lines.filter((line) => !line.startsWith("-")).length;

    body.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, ...lines);
    for (const line of lines) {
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
    }
  }

  if (body.length === 0) {
    return undefined;
  }
  return capHunk(body, deletions, additions, options);
}

/**
 * Build an all-additions hunk, for a file the tool created outright.
 */
export function buildAdditionHunk(
  text: string,
  options: UnifiedHunkOptions,
): UnifiedHunkResult | undefined {
  const lines = splitLines(text);
  if (lines.length === 1 && lines[0] === "") {
    return undefined;
  }
  const body = [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)];
  return capHunk(body, 0, lines.length, options);
}

/**
 * Apply the line and character caps, preserving the `@@` header so the result
 * is still parseable as a hunk after truncation.
 */
function capHunk(
  body: ReadonlyArray<string>,
  deletions: number,
  additions: number,
  options: UnifiedHunkOptions,
): UnifiedHunkResult {
  let truncated = false;
  let lines = [...body];

  if (lines.length > options.maxLines) {
    lines = lines.slice(0, options.maxLines);
    truncated = true;
  }

  let diff = lines.join("\n");
  if (diff.length > options.maxChars) {
    // Cut on a line boundary so the tail is never a half-written line.
    const clipped = diff.slice(0, options.maxChars);
    const lastNewline = clipped.lastIndexOf("\n");
    diff = lastNewline > 0 ? clipped.slice(0, lastNewline) : clipped;
    truncated = true;
  }

  if (truncated) {
    // A multi-hunk body can be cut right after an `@@` header, which renders as
    // an empty hunk. Drop the orphan.
    diff = diff.replace(/\n@@[^\n]*@@$/, "");
  }

  return { diff, truncated, additions, deletions };
}
