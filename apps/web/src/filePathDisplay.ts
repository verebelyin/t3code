import { pipe } from "effect/Function";
import {
  fileBasename,
  stripSlashPrefixedWindowsDrive,
  isWindowsAbsolutePath,
} from "@t3tools/shared/path";
import { formatFilePathPosition, splitFilePathPosition } from "@t3tools/shared/fileLinks";

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
  // `"labelled"` (default) prefixes the workspace dir (`t3code/src/foo.ts`);
  // `"bare"` drops it (`src/foo.ts`) for tool rows, where the workspace is implied.
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
    const normalizedWorkspaceRoot = pipe(
      trimTrailingPathSeparators(workspaceRoot),
      normalizePathSeparators,
      stripSlashPrefixedWindowsDrive,
    );
    const workspaceLabel = fileBasename(normalizedWorkspaceRoot);
    const caseInsensitive = isWindowsAbsolutePath(stripSlashPrefixedWindowsDrive(workspaceRoot));
    const pathForCompare = caseInsensitive ? normalizedPath.toLowerCase() : normalizedPath;
    const workspaceForCompare = caseInsensitive
      ? normalizedWorkspaceRoot.toLowerCase()
      : normalizedWorkspaceRoot;
    const workspaceWithSeparator = `${workspaceForCompare}/`;
    const workspaceLabelWithSeparator = `${caseInsensitive ? workspaceLabel.toLowerCase() : workspaceLabel}/`;

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
