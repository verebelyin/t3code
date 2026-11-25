# Fork touchpoints

This fork adds the Command Code provider, an always-on 5h / 7d meter in the
composer, and subagent model, effort, and token labels on top of upstream
`pingdotgg/t3code`. To keep `git merge origin/main` cheap, fork code follows
two rules:

1. **Fork logic lives in its own files.** Upstream files carry only the hook-in
   lines (an import, a prop, a `<Component />`). Extract before growing an
   inline block past a screenful.
2. **Fork tests live in their own files**, named by feature next to the
   upstream test they extend. Never append cases to an upstream test file;
   upstream appends there too and both sides conflict.

Fork-only fields in shared objects (settings schemas, search items) sit in a
commented block at the tail of the object. Before adding fork code, check
whether upstream now ships an equivalent; reuse its helpers rather than copying
an upstream component body into a fork file.

## Fork-only files

- Command Code: `apps/server/src/provider/commandcode/`,
  `packages/contracts/src/commandcode.ts`, and
  `packages/client-runtime/src/commandCodeClient.ts` (label and icon as data).
  It is not in the ACP registry, and the registry route would lose its
  permission mapping, question extraction, loop guard, auth, and usage reader.
  `CommandCodeUsage.ts` reads native sessions (`~/.commandcode/projects`); its
  `inputTokens` is the AI SDK total, so cache reads and writes are subtracted.
- `apps/web/src/components/chat/ComposerContextMeter.tsx` — the context window
  as a ring beside the chip. Upstream deleted its composer meter and the
  `contextWindowMeterEnabled` setting in #33131 and shows context only in
  thread details; here the ring is always on.
- `apps/web/src/components/chat/RateLimitMeter.tsx`, `apps/web/src/lib/rateLimits.ts`
  — the composer chip. It reads the instance's `usageLimits` with upstream's
  `@t3tools/shared/usageLimits` and `usageLimitsCopy` helpers; upstream's thread details "Usage
  limits" item carries the full breakdown.
- Subagent model, effort, and tokens: `packages/contracts/src/subagentTokenUsage.ts`
  (the wire schema; upstream's `SubagentUsage` is a client-only interface),
  `apps/server/src/orchestration-v2/subagentTokenUsage.ts` (delegated roll-up and
  Claude task usage), `apps/web/src/components/chat/subagentModelTraits.ts` and
  `SubagentModelTraitsLabel.tsx`. An unset effort reads as the model's default,
  as upstream's model-switch markers do.

- Bitbucket without a credential: `packages/source-control-bitbucket/src/server/bitbucketAnonymous.ts`.
  Upstream reports an anonymous read of a private repository as not found, then
  as a rate limit once the anonymous quota is spent, and never asks for
  credentials.

## Cherry-picked upstream work

- Jira Cloud tracker: draft upstream PR #38003 (`packages/issue-tracker-jira`, the
  `IssueTrackerCredential` with `credential.fields`), merged onto upstream's
  multi-account trackers. Jira's `parseIssueUrl` and the probe's `workspace` are
  fork additions. When upstream lands its own version, take upstream's side for
  every Jira and tracker-credential file and drop this entry.

## Upstream files with hook-ins

Expect these to conflict first; resolve by keeping upstream and re-adding the
hook-in. Fork copy in linted client code (`no-untranslated-copy`) carries a
reasoned disable comment instead of an entry in upstream's proper-noun list.

- Command Code: `builtInDrivers.ts` (driver and `BUILT_IN_USAGE_DRIVERS`),
  `ProviderRegistry.ts`, `contracts/src/model.ts`, `contracts/src/index.ts`,
  `"commandcode"` in `UsageProviderKind` (`contracts/src/usage.ts`),
  `client-runtime/src/providerClients.ts`, `KNOWN_DRIVERS` in
  `policy/managedProviders.ts`, `settingsSearch.ts`, the exhaustive
  web and mobile `usageProviders.ts` tables, and the provider lists in
  `docs/user/install.md` and `permission-modes.md`.
- `ChatComposer.tsx` passes the instance's `usageLimits` to
  `ComposerFooterPrimaryActions`, which renders `<RateLimitMeter />`
  (`ComposerFooterControls.tsx`). `ChatView.tsx` passes `activeContextWindow`
  down the same path to `<ComposerContextMeter />`.
- Telemetry is opt-in: `T3CODE_TELEMETRY_ENABLED` defaults to false in
  `AnalyticsService.ts` (both reads) and `isRelayTracingEnabled`
  (`shared/src/otelEnvironment.ts`), with `// Fork:` tests in
  `otelEnvironment.test.ts` and desktop `ipc/methods/window.test.ts`, and
  `docs/user/telemetry.md` and `faq.md`.
- Defaults in `contracts/src/settings.ts`: `chatWidth` is `"wide"`,
  `sidebarWorkingShelfEnabled` is `false`, `inAppNotificationsEnabled` is
  `true`, `compactIdleThreads` is `true` (idle compaction "beforeCacheExpires"),
  and `defaultModelSelection` is Claude Opus 5.5 at high effort. The "(default)"
  label in `AppearanceSettingsPanel.tsx` and the Working section paragraph in
  `docs/user/thread-sidebar.md` follow them. Mobile keeps its own preference.
  Upstream assumes a null default model: `serverSettings.ts` lists it in
  `ATOMIC_SETTINGS_KEYS` and replaces it whole in `makeTest`, and
  `listManageableSettings` (`policy/managedSettings.ts`) keeps nullable settings
  whole. Upstream tests that read these defaults compare against
  `DEFAULT_SERVER_SETTINGS`, or carry a `// Fork:` line.
- `orchestrationV2.ts` — `usage` on `OrchestrationV2Subagent`.
- `Orchestrator.ts` — `modelSelection` on app-owned tasks and the usage roll-up
  in `finalizeAppOwnedSubagentTask`, which reads the child run's attempts and
  provider turns itself (upstream's `DelegatedChildControls` omits them); `ClaudeAdapterV2.ts` — `usage` on
  `updateClaudeSubagentNode`.
- `BitbucketApi.ts` — `anonymous` on the two response errors, set in
  `responseError`, and no host pause for an anonymous 429 in `throttled`;
  `BitbucketPullRequestProvider.ts` — the first line of `bitbucketProviderFailure`.
- `ThreadTerminalDrawer.tsx` — the single-terminal action buttons sit in a row
  above the terminal; upstream floats them over its top-right corner.
- `SubagentTooltipContent.tsx` (`<SubagentTokenUsageLine />`), `V2LifecycleRow.tsx`,
  `TimelineV2EventRow.tsx` (group header), `ThreadRelationshipsControl.tsx`
  (Lineage token slot).
