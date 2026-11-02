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
- `apps/web/src/components/chat/RateLimitMeter.tsx`, `apps/web/src/lib/rateLimits.ts`
  — the composer chip. It reads the instance's `usageLimits` with upstream's
  `@t3tools/shared/usageLimits` helpers; upstream's thread details "Usage
  limits" item carries the full breakdown.
- Subagent model, effort, and tokens: `packages/contracts/src/subagentTokenUsage.ts`
  (the wire schema; upstream's `SubagentUsage` is a client-only interface),
  `apps/server/src/orchestration-v2/subagentTokenUsage.ts` (delegated roll-up and
  Claude task usage), `apps/web/src/components/chat/subagentModelTraits.ts` and
  `SubagentModelTraitsLabel.tsx`. An unset effort reads as the model's default,
  as upstream's model-switch markers do.

## Upstream files with hook-ins

Expect these to conflict first; resolve by keeping upstream and re-adding the
hook-in.

- Command Code: `builtInDrivers.ts` (driver and `BUILT_IN_USAGE_DRIVERS`),
  `ProviderRegistry.ts`, `contracts/src/model.ts`, `contracts/src/index.ts`,
  `"commandcode"` in `UsageProviderKind` (`contracts/src/usage.ts`),
  `client-runtime/src/providerClients.ts`, `settingsSearch.ts`, the exhaustive
  web and mobile `usageProviders.ts` tables, and the provider lists in
  `docs/user/install.md` and `permission-modes.md`.
- `ChatComposer.tsx` passes the instance's `usageLimits` to
  `ComposerFooterPrimaryActions`, which renders `<RateLimitMeter />`
  (`ComposerFooterControls.tsx`).
- `orchestrationV2.ts` — `usage` on `OrchestrationV2Subagent`.
- `Orchestrator.ts` — `modelSelection` on app-owned tasks and the usage roll-up
  in `finalizeAppOwnedSubagentTask`; `ClaudeAdapterV2.ts` — `usage` on
  `updateClaudeSubagentNode`.
- `SubagentTooltipContent.tsx` (`<SubagentTokenUsageLine />`), `V2LifecycleRow.tsx`,
  `TimelineV2EventRow.tsx` (group header), `ThreadRelationshipsControl.tsx`
  (Lineage token slot).
