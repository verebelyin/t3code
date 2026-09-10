import { EnvironmentId, type ToolInvocation } from "@t3tools/contracts";
import { createRef, type ReactNode, type Ref } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { LegendListRef, MaintainScrollAtEndOptions } from "@legendapp/list/react";

// Rich tool-call rows and expanded tool calls. Kept apart from
// MessagesTimeline.test.tsx so upstream edits there merge cleanly; the render
// harness is duplicated on purpose.

vi.mock("@legendapp/list/react", async () => {
  const legendListTestId = "legend-list";

  const LegendList = (props: {
    data: Array<{ id: string }>;
    keyExtractor: (item: { id: string }) => string;
    renderItem: (args: { item: { id: string } }) => ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
    anchoredEndSpace?: {
      anchorIndex: number;
      anchorMaxSize?: number;
      anchorOffset?: number;
      onReady?: (info: { anchorIndex: number }) => void;
    };
    contentInsetEndAdjustment?: number;
    className?: string;
    maintainScrollAtEnd?: boolean | MaintainScrollAtEndOptions;
    maintainVisibleContentPosition?:
      | boolean
      | {
          data?: boolean;
          size?: boolean;
          shouldRestorePosition?: (item: { id: string }) => boolean;
        };
    ref?: Ref<LegendListRef>;
  }) => {
    if (props.anchoredEndSpace) {
      props.anchoredEndSpace.onReady?.({ anchorIndex: props.anchoredEndSpace.anchorIndex });
    }
    return (
      <div
        data-testid={legendListTestId}
        data-anchor-index={props.anchoredEndSpace?.anchorIndex}
        data-anchor-max-size={props.anchoredEndSpace?.anchorMaxSize}
        data-anchor-offset={props.anchoredEndSpace?.anchorOffset}
        data-anchor-on-ready={Boolean(props.anchoredEndSpace?.onReady)}
        data-content-inset-end={props.contentInsetEndAdjustment}
        data-class-name={props.className}
        data-maintain-scroll-at-end={props.maintainScrollAtEnd ? "enabled" : undefined}
        data-maintain-scroll-at-end-animated={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.animated
            : undefined
        }
        data-maintain-scroll-at-end-data-change={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.dataChange
            : undefined
        }
        data-maintain-scroll-at-end-footer-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.footerLayout
            : undefined
        }
        data-maintain-scroll-at-end-item-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.itemLayout
            : undefined
        }
        data-maintain-scroll-at-end-layout={
          typeof props.maintainScrollAtEnd === "object"
            ? props.maintainScrollAtEnd.on?.layout
            : undefined
        }
        data-maintain-visible-content-position={
          typeof props.maintainVisibleContentPosition === "object"
            ? "object"
            : props.maintainVisibleContentPosition
        }
        data-maintain-visible-content-position-data={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.data
            : undefined
        }
        data-maintain-visible-content-position-size={
          typeof props.maintainVisibleContentPosition === "object"
            ? props.maintainVisibleContentPosition.size
            : undefined
        }
        data-maintain-visible-content-position-restore={
          typeof props.maintainVisibleContentPosition === "object"
            ? Boolean(props.maintainVisibleContentPosition.shouldRestorePosition)
            : undefined
        }
      >
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  };

  return { LegendList };
});

function MockFileDiff(props: {
  fileDiff: { name?: string | null; prevName?: string | null };
  renderCustomHeader?: (fileDiff: {
    name?: string | null;
    prevName?: string | null;
  }) => React.ReactNode;
}) {
  return (
    <div data-testid="file-diff">
      {props.renderCustomHeader?.(props.fileDiff)}
      {props.fileDiff.name ?? props.fileDiff.prevName ?? "diff"}
    </div>
  );
}

vi.mock("@pierre/diffs/react", () => {
  return { FileDiff: MockFileDiff };
});

vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => children,
}));

function matchMedia() {
  return {
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

let MessagesTimeline: typeof import("./MessagesTimeline").MessagesTimeline;

beforeAll(async () => {
  const classList = {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false,
  };

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  });
  vi.stubGlobal("window", {
    matchMedia,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    cancelAnimationFrame: () => {},
    desktopBridge: undefined,
  });
  vi.stubGlobal("document", {
    documentElement: {
      classList,
      offsetHeight: 0,
    },
  });

  ({ MessagesTimeline } = await import("./MessagesTimeline"));
}, 30_000);

const ACTIVE_THREAD_ENVIRONMENT_ID = EnvironmentId.make("environment-local");

function buildProps() {
  return {
    isWorking: false,
    activeTurnInProgress: false,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    latestTurn: null,
    runningTurnId: null,
    turnDiffSummaries: [],
    routeThreadKey: "environment-local:thread-1",
    onOpenTurnDiff: () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: ACTIVE_THREAD_ENVIRONMENT_ID,
    markdownCwd: undefined,
    resolvedTheme: "light" as const,
    timestampFormat: "locale" as const,
    workspaceRoot: undefined,
    richToolCallRows: true,
    // Off in the fixture: most tests assert the collapsed-by-default timeline;
    // expanded-mode tests opt in per render.
    expandedToolCalls: false,
    anchorMessageId: null,
    onAnchorReady: () => {},
    contentInsetEndAdjustment: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
    onManualNavigation: () => {},
  };
}

describe("MessagesTimeline tool invocation rows", () => {
  it("renders a named tool row with a bare workspace-relative path", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        expandedToolCalls
        workspaceRoot="/Users/me/dev/t3code"
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Tool call",
              tone: "tool",
              toolTitle: "Tool call",
              itemType: "dynamic_tool_call",
              toolInvocation: {
                name: "Read",
                target: "/Users/me/dev/t3code/apps/web/src/a.ts",
                targetKind: "path",
              },
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Read(apps/web/src/a.ts)");
    // The target is already inside the parentheses — it must not be repeated
    // as a preview suffix.
    expect(markup).not.toContain("Read(apps/web/src/a.ts) - ");
    expect(markup).not.toContain("/Users/me/dev/t3code/apps/web");
  });

  it("renders non-path targets verbatim", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        expandedToolCalls
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Tool call",
              tone: "tool",
              toolTitle: "Command run",
              itemType: "command_execution",
              toolInvocation: {
                name: "Bash",
                target: "pnpm test run",
                targetKind: "command",
              },
            },
          },
        ]}
      />,
    );

    expect(markup).toContain("Bash(pnpm test run)");
  });

  it("keeps file-change bodies open from first render when expanded tool calls are on", () => {
    // Old threads included: openness derives from the entry kind, not from
    // having observed the call run.
    const fileEntry = {
      id: "entry-1",
      kind: "work" as const,
      createdAt: "2026-03-17T19:12:28.000Z",
      entry: {
        id: "work-1",
        createdAt: "2026-03-17T19:12:28.000Z",
        label: "Tool call",
        tone: "tool" as const,
        itemType: "file_change" as const,
        detail: "src/foo.ts updated",
        changedFiles: ["src/foo.ts"],
      },
    };

    const openMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} expandedToolCalls timelineEntries={[fileEntry]} />,
    );
    expect(openMarkup).toContain("max-h-[48.75em]");

    const offMarkup = renderToStaticMarkup(
      <MessagesTimeline {...buildProps()} timelineEntries={[fileEntry]} />,
    );
    expect(offMarkup).not.toContain("max-h-[48.75em]");
  });

  it("renders settled command bodies closed even with expanded tool calls on", () => {
    const markup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        expandedToolCalls
        timelineEntries={[
          {
            id: "entry-1",
            kind: "work",
            createdAt: "2026-03-17T19:12:28.000Z",
            entry: {
              id: "work-1",
              createdAt: "2026-03-17T19:12:28.000Z",
              label: "Tool call",
              tone: "tool",
              itemType: "command_execution",
              detail: "pnpm test output",
            },
          },
        ]}
      />,
    );

    expect(markup).not.toContain("max-h-[48.75em]");
  });

  it("keeps a running command body closed regardless of captured output", () => {
    // Command rows never auto-open — only a manual toggle reveals the terminal
    // body. Only file-change rows stay open on their own.
    const runningCommandEntry = (output?: string) => ({
      id: "entry-1",
      kind: "work" as const,
      createdAt: "2026-03-17T19:12:28.000Z",
      entry: {
        id: "work-1",
        createdAt: "2026-03-17T19:12:28.000Z",
        label: "Tool call",
        tone: "tool" as const,
        itemType: "command_execution" as const,
        command: "pnpm test run",
        toolLifecycleStatus: "inProgress" as const,
        toolInvocation: {
          name: "Bash",
          target: "pnpm test run",
          targetKind: "command" as const,
          ...(output === undefined ? {} : { output }),
        },
      },
    });

    const noOutputMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        expandedToolCalls
        activeTurnInProgress
        timelineEntries={[runningCommandEntry()]}
      />,
    );
    // Closed row: the terminal body (and its "no output" placeholder) is not
    // rendered at all.
    expect(noOutputMarkup).not.toContain("no output");

    const withOutputMarkup = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        expandedToolCalls
        activeTurnInProgress
        timelineEntries={[runningCommandEntry("42 tests passed")]}
      />,
    );
    expect(withOutputMarkup).not.toContain("42 tests passed");
  });

  it("falls back to the generic heading when the setting is off", () => {
    // Toggle-off regression guard: with `richToolCallRows` false the output must
    // be identical to an entry that carries no invocation at all, so turning the
    // feature off is a true revert rather than a third rendering mode.
    const entry = {
      id: "work-1",
      createdAt: "2026-03-17T19:12:28.000Z",
      label: "Tool call",
      tone: "tool" as const,
      toolTitle: "Tool call",
      itemType: "dynamic_tool_call" as const,
      detail: "Read: some detail",
    };
    const timelineEntries = (invocation?: ToolInvocation) => [
      {
        id: "entry-1",
        kind: "work" as const,
        createdAt: "2026-03-17T19:12:28.000Z",
        entry: invocation ? { ...entry, toolInvocation: invocation } : entry,
      },
    ];

    const withInvocationOff = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        richToolCallRows={false}
        timelineEntries={timelineEntries({
          name: "Read",
          target: "/repo/src/a.ts",
          targetKind: "path",
        })}
      />,
    );
    const withoutInvocation = renderToStaticMarkup(
      <MessagesTimeline
        {...buildProps()}
        richToolCallRows={false}
        timelineEntries={timelineEntries()}
      />,
    );

    expect(withInvocationOff).toBe(withoutInvocation);
    expect(withInvocationOff).not.toContain("Read(");
  });
});
