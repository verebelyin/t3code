/**
 * Rendering pieces for rich tool-call rows: `Read(src/foo.ts)` headings, the
 * terminal-style command block, inline file diffs, and the per-row status
 * indicator. Kept out of `MessagesTimeline.tsx` so the timeline only carries a
 * few hook-in lines and upstream changes to it merge cleanly.
 */
import { type ToolInvocation } from "@t3tools/contracts";
import { formatToolInvocationLabel, toolDisplayName } from "@t3tools/shared/toolInvocationLabel";
import { Suspense, use, useMemo } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { CheckIcon, LoaderCircleIcon, MinusIcon, XIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  getRenderablePatch,
  resolveDiffThemeName,
  type DiffThemeName,
} from "../../lib/diffRendering";
import { getSyntaxHighlighterPromise, PREFERRED_HIGHLIGHTER } from "../../lib/syntaxHighlighting";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";
import { type CommandInvocationView } from "../../commandInvocationDisplay";
import { buildToolInvocationPatch } from "../../toolInvocationDisplay";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export type ToolInvocationIconName = "eye" | "terminal" | "square-pen" | "hammer" | "globe";

export type ToolInvocationChange = NonNullable<ToolInvocation["changes"]>[number];

/** Icon for a named invocation, so `Read` does not inherit the edit pencil. */
export function invocationIconName(invocation: ToolInvocation): ToolInvocationIconName | undefined {
  switch (toolDisplayName(invocation.name)) {
    case "Read":
    case "Grep":
    case "Glob":
      return "eye";
    case "Bash":
      return "terminal";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return "square-pen";
    case "Task":
      return "hammer";
    case "WebFetch":
    case "WebSearch":
      return "globe";
    default:
      return undefined;
  }
}

/**
 * Format a tool invocation target for display. Paths become bare
 * workspace-relative (`src/foo.ts`); everything else is shown as reported.
 */
function formatInvocationTarget(
  invocation: ToolInvocation,
  workspaceRoot: string | undefined,
): string | undefined {
  if (invocation.target === undefined) return undefined;
  return invocation.targetKind === "path"
    ? formatWorkspaceRelativePath(invocation.target, workspaceRoot, { style: "bare" })
    : invocation.target;
}

/** `Read(src/foo.ts)` for a named call; `null` when the label would be empty. */
export function toolInvocationHeading(
  invocation: ToolInvocation,
  workspaceRoot: string | undefined,
): string | null {
  const label = formatToolInvocationLabel({
    name: invocation.name,
    target: formatInvocationTarget(invocation, workspaceRoot),
    ...(invocation.targetKind ? { targetKind: invocation.targetKind } : {}),
  });
  return label.length > 0 ? label : null;
}

/** The changes that carry a renderable diff; the rest only list a path. */
export function toolInvocationDiffChanges(
  invocation: ToolInvocation | undefined,
): ToolInvocationChange[] {
  return (invocation?.changes ?? []).filter((change) => change.diff !== undefined);
}

const COMMAND_CODE_CLASS =
  "min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/90 select-text";

/**
 * The command, highlighted as shell source by the same Shiki instance the diff
 * and markdown renderers use, so a `Bash` row is themed like everything else.
 *
 * Suspends while the `bash` grammar loads; the caller renders the plain command
 * as the fallback, which is what stays on screen if highlighting never resolves.
 */
function HighlightedCommand(props: { command: string; themeName: DiffThemeName }) {
  const { command, themeName } = props;
  const highlighter = use(getSyntaxHighlighterPromise("bash"));
  const html = useMemo(() => {
    try {
      return highlighter.codeToHtml(command, { lang: "bash", theme: themeName });
    } catch {
      return null;
    }
  }, [command, highlighter, themeName]);

  if (html === null) {
    return <code className={COMMAND_CODE_CLASS}>{command}</code>;
  }
  return (
    <div
      className={cn(COMMAND_CODE_CLASS, "tool-command-shiki")}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Expanded body of a command tool call, shaped like a terminal transcript.
 *
 * A prompt line carries the command and its exit status; the captured output
 * scrolls beneath it. Deliberately static — our users watch these rows all day
 * and a repainting caret or spinner here would cost frames for nothing.
 */
export function CommandInvocationBlock(props: {
  view: CommandInvocationView;
  resolvedTheme: "light" | "dark";
}) {
  const { command, output, outputTruncated, exitCode, failed } = props.view;
  const themeName = resolveDiffThemeName(props.resolvedTheme);
  return (
    <div className="overflow-hidden rounded-md border border-border/50">
      <div className="flex items-start gap-2 bg-muted/50 px-2.5 py-2">
        <span
          className="shrink-0 select-none font-mono text-[11px] leading-relaxed text-muted-foreground/50"
          aria-hidden
        >
          $
        </span>
        <Suspense fallback={<code className={COMMAND_CODE_CLASS}>{command}</code>}>
          <HighlightedCommand command={command} themeName={themeName} />
        </Suspense>
        {exitCode !== undefined ? (
          <span
            className={cn(
              "shrink-0 select-none rounded-sm px-1 py-px font-mono text-[10px] leading-relaxed",
              failed
                ? "bg-destructive/12 text-destructive"
                : "bg-foreground/6 text-muted-foreground/80",
            )}
          >
            exit {exitCode}
          </span>
        ) : null}
      </div>
      {output ? (
        <>
          <pre className="max-h-64 cursor-text overflow-auto border-t border-border/40 px-2.5 py-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground select-text">
            {output}
          </pre>
          {outputTruncated ? (
            <p className="border-t border-border/30 px-2.5 py-1 font-mono text-[10px] leading-relaxed text-muted-foreground/50">
              Output truncated
            </p>
          ) : null}
        </>
      ) : (
        <p className="border-t border-border/40 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground/45">
          no output
        </p>
      )}
    </div>
  );
}

/**
 * Inline diffs for a file-changing invocation. Parsing and highlighting a
 * patch pulls in shiki, so mount this only once the row has been opened.
 */
export function ToolInvocationDiffs(props: {
  entryId: string;
  changes: ReadonlyArray<ToolInvocationChange>;
  workspaceRoot: string | undefined;
  resolvedTheme: "light" | "dark";
}) {
  const { entryId, changes, workspaceRoot, resolvedTheme } = props;
  const renderedDiffs = useMemo(
    () =>
      changes.flatMap((change) => {
        const displayPath = formatWorkspaceRelativePath(change.path, workspaceRoot, {
          style: "bare",
        });
        const patch = getRenderablePatch(
          buildToolInvocationPatch(change, displayPath),
          `tool-invocation:${entryId}:${change.path}`,
        );
        // `null` (empty patch) and `kind: "raw"` (unparseable) both fall back to
        // the plain text body rather than rendering a broken diff.
        if (patch === null || patch.kind !== "files") {
          return [];
        }
        return patch.files.map((fileDiff, index) => ({
          key: `${change.path}:${index}`,
          fileDiff,
        }));
      }),
    [changes, entryId, workspaceRoot],
  );

  if (renderedDiffs.length === 0) return null;
  return (
    // ~30 lines of the default code font, then scrolls.
    <div className="diff-render-surface max-h-[536px] overflow-auto overscroll-contain">
      {renderedDiffs.map(({ key, fileDiff }) => (
        <FileDiff
          key={key}
          fileDiff={fileDiff}
          options={{
            collapsed: false,
            diffStyle: "unified",
            theme: resolveDiffThemeName(resolvedTheme),
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
          }}
        />
      ))}
    </div>
  );
}

export type ToolCallStatus = "running" | "failed" | "completed" | "empty" | null;

function StatusIndicator(props: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex size-4 items-center justify-center" />}>
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** Trailing per-row status glyph: spinner while running, then ✓ / ✗ / – once settled. */
export function ToolCallStatusIndicator({ status }: { status: ToolCallStatus }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {status === "running" ? (
        <StatusIndicator label="Running">
          <LoaderCircleIcon
            className="block size-3 shrink-0 animate-spin text-muted-foreground/70"
            aria-hidden
          />
        </StatusIndicator>
      ) : status === "failed" ? (
        <StatusIndicator label="Failed">
          <XIcon className="block size-3 shrink-0 text-destructive" aria-hidden />
        </StatusIndicator>
      ) : status === "completed" ? (
        <StatusIndicator label="Completed">
          <CheckIcon
            className="block size-3 shrink-0 stroke-current"
            stroke="currentColor"
            aria-hidden
          />
        </StatusIndicator>
      ) : status === "empty" ? (
        <StatusIndicator label="Empty">
          <MinusIcon className="block size-3 shrink-0 opacity-70" aria-hidden />
        </StatusIndicator>
      ) : null}
    </span>
  );
}
