import {
  fileBasename,
  formatFilePathPosition,
  splitFilePathPosition,
  stripSlashPrefixedWindowsDrive,
} from "@t3tools/client-runtime/markdown-links";

function normalizePathSeparators(path: string): string {
  return path.replaceAll("\\", "/");
}

function trimTrailingPathSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function stripRelativePrefixes(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export interface FormatWorkspaceRelativePathOptions {
  /**
   * `"labelled"` (default) prefixes the workspace directory name, e.g.
   * `t3code/src/foo.ts` — useful when a row could refer to more than one
   * workspace.
   *
   * `"bare"` returns just the relative suffix, e.g. `src/foo.ts`. Used by tool
   * rows, where the workspace is already implied by the surrounding thread and
   * the prefix is pure noise inside `Read(...)`.
   */
  readonly style?: "labelled" | "bare";
}

export function formatWorkspaceRelativePath(
  pathWithPosition: string,
  workspaceRoot: string | undefined,
  options?: FormatWorkspaceRelativePathOptions,
): string {
  const bare = options?.style === "bare";
  const position = splitFilePathPosition(pathWithPosition);
  const normalizedPath = stripSlashPrefixedWindowsDrive(normalizePathSeparators(position.path));

  let displayPath = normalizedPath;
  if (workspaceRoot) {
    const normalizedWorkspaceRoot = stripSlashPrefixedWindowsDrive(
      normalizePathSeparators(trimTrailingPathSeparators(workspaceRoot)),
    );
    const workspaceLabel = fileBasename(normalizedWorkspaceRoot);
    const pathForCompare = normalizedPath.toLowerCase();
    const workspaceForCompare = normalizedWorkspaceRoot.toLowerCase();
    const workspaceWithSeparator = `${workspaceForCompare}/`;
    const workspaceLabelWithSeparator = `${workspaceLabel.toLowerCase()}/`;

    if (pathForCompare === workspaceForCompare) {
      // The workspace root itself. "." is the only sensible bare rendering —
      // an empty string would read as a missing value.
      displayPath = bare ? "." : workspaceLabel;
    } else if (pathForCompare.startsWith(workspaceWithSeparator)) {
      const relativeSuffix = normalizedPath.slice(normalizedWorkspaceRoot.length + 1);
      displayPath = bare ? relativeSuffix : `${workspaceLabel}/${relativeSuffix}`;
    } else if (!normalizedPath.startsWith("/")) {
      const relativePath = stripRelativePrefixes(normalizedPath);
      if (bare) {
        // Already relative. Strip a redundant leading workspace-name segment so
        // `t3code/src/a.ts` and `src/a.ts` render the same.
        displayPath = pathForCompare.startsWith(workspaceLabelWithSeparator)
          ? relativePath.slice(workspaceLabel.length + 1)
          : relativePath;
      } else {
        displayPath = pathForCompare.startsWith(workspaceLabelWithSeparator)
          ? normalizedPath
          : `${workspaceLabel}/${relativePath}`;
      }
    }
  }

  return formatFilePathPosition({ ...position, path: displayPath });
}
