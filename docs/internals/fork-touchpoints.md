# Fork touchpoints

This fork carries rich tool-call rows, expanded tool calls, chat width, and
account rate-limit meters on top of upstream `pingdotgg/t3code`. To keep
`git merge origin/main` cheap, fork code follows two rules:

1. **Fork logic lives in its own files.** Upstream files carry only the hook-in
   lines (an import, a prop, a `<Component />`). Extract before growing an
   inline block past a screenful.
2. **Fork tests live in their own files**, named by feature next to the
   upstream test they extend (`session-logic.toolInvocation.test.ts`,
   `threadReducer.rateLimits.test.ts`, ...). Never append cases to an upstream
   test file; upstream appends there too and both sides conflict.

Fork-only fields in shared objects (settings schemas, search items) sit in a
commented block at the tail of the object.

## Fork-only files

- `apps/web/src/components/chat/ToolInvocationRow.tsx` — heading, command
  block, inline diffs, status indicator for tool rows.
- `apps/web/src/components/settings/ForkAppearanceSettingsRows.tsx` — the
  three appearance settings rows.
- `apps/web/src/components/chat/RateLimitMeter.tsx`, `apps/web/src/lib/rateLimits.ts`.
- `apps/web/src/commandInvocationDisplay.ts`, `toolInvocationDisplay.ts`,
  `taskProgressDisplay.ts`.
- `apps/server/src/provider/Layers/claudeToolInvocation.ts`,
  `codexToolInvocation.ts`, `apps/server/src/provider/unifiedHunk.ts`.
- `packages/shared/src/toolInvocationLabel.ts`.

## Upstream files with hook-ins

Expect these to conflict first; resolve by keeping upstream and re-adding the
hook-in.

- `MessagesTimeline.tsx` — `PlainWorkEntryRow` reads `richToolCallRows` /
  `expandedToolCalls` from context and mounts the `ToolInvocationRow` pieces;
  `activeTurnInProgress` prop; `TIMELINE_MAINTAIN_SCROLL_AT_END_THRESHOLD`.
- `MessagesTimeline.logic.ts` — `expandAllToolCalls` input, `toolCallPanelKind`.
- `ChatView.tsx`, `ChatComposer.tsx` — settings reads, `activeTurnInProgress`,
  rate-limit snapshot plumbing.
- `session-logic.ts` — `toolInvocation`, `taskMeta`, `exitCode` on work entries.
- `packages/contracts/src/settings.ts`, `providerRuntime.ts`.
- `ActivityPayloadProjection.ts`, `ProviderRuntimeIngestion.ts`,
  `ClaudeAdapter.ts`, `CodexAdapter.ts` — `payload.tool` emission and
  rate-limit activities. `ClaudeAdapter.ts` still carries a large inline block;
  next candidate for extraction.
