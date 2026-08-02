import type { ToolInvocationChange } from "@t3tools/contracts";

/**
 * Wrap a tool invocation's hunk body in the file headers a patch parser needs.
 *
 * Adapters ship hunk bodies only (`@@` plus `-`/`+`/context lines) so Claude —
 * which emits no diff and has one synthesized — and Codex — which emits a full
 * patch that gets stripped — converge on one shape. The headers are re-added
 * here, against the path we are about to display, so the diff header reads as
 * the relative path rather than the absolute one the provider reported.
 *
 * Mirrors `buildReviewCommentRenderablePatch` in `reviewCommentContext.ts`.
 *
 * @module toolInvocationDisplay
 */
export function buildToolInvocationPatch(
  change: Pick<ToolInvocationChange, "diff">,
  displayPath: string,
): string {
  const diff = change.diff?.trim() ?? "";
  if (diff.length === 0) {
    return "";
  }
  // Defensive: an adapter that skips header stripping should not end up with
  // two sets of headers.
  if (diff.startsWith("diff --git ")) {
    return diff;
  }

  const normalizedPath = displayPath.replaceAll("\\", "/");
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    diff,
  ].join("\n");
}
