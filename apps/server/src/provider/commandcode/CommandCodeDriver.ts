import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import {
  COMMAND_CODE_DRIVER_KIND,
  CommandCodeSettings,
  ProviderDriverKind,
  TextGenerationError,
  type ServerProvider,
  type ServerProviderSlashCommand,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type * as AcpSchema from "effect-acp/compat";

import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { IdAllocatorV2 } from "@t3tools/provider-core/server/IdAllocator";
import { ProviderContinuationRequests } from "@t3tools/provider-core/server/ProviderContinuationRequests";
import { makeAcpNativeLoggerFactory } from "@t3tools/provider-acp/server/nativeLogging";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import { ProviderDriverError } from "../Errors.ts";
import { ProviderEventLoggers } from "@t3tools/provider-core/server/ProviderEventLoggers";
import { upsertProviderWorkspaceSnapshot } from "../ProviderRegistry.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  makeCachedProviderMaintenanceResolution,
  makeManualOnlyProviderMaintenanceCapabilities,
  makePackageManagedProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "@t3tools/provider-core/server/maintenanceResolver";
import {
  buildServerProvider,
  parseGenericCliVersion,
  spawnAndCollect,
} from "@t3tools/provider-core/server/snapshotProbe";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import {
  commandCodeModels,
  makeCommandCodeAcpRuntime,
  type CommandCodeAcpRuntimeInput,
} from "./CommandCodeAcpSupport.ts";
import { makeCommandCodeAdapterV2 } from "./CommandCodeAdapter.ts";
import { commandCodeUsageReader } from "./CommandCodeUsage.ts";

const DRIVER = ProviderDriverKind.make(COMMAND_CODE_DRIVER_KIND);
const MINIMUM_VERSION = "1.74.0";
const PRESENTATION = {
  displayName: "Command Code",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
  // ACP "auto" would approve every request; Command Code has no classifier mode.
  supportedRuntimeModes: ["approval-required", "auto-accept-edits", "full-access"],
  reportsContextWindow: true,
  supportsConversationRollback: false,
} as const;
export const COMMAND_CODE_CHECKING_MESSAGE = "Checking Command Code…";
// ACP creates the native harness before T3 can switch it to plan mode, and the
// CLI allows file tools there, so there is no tool-free session to generate in.
const unsupportedTextGeneration: ProviderTextGeneration = (() => {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail:
          "Command Code text generation is unavailable: its ACP CLI has no tool-free mode. Use another provider for commit, branch, title, review guide, or change request generation.",
      }),
    );
  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateTranscriptionPostProcessing: () => unsupported("generateTranscriptionPostProcessing"),
    generateReviewGuide: () => unsupported("generateReviewGuide"),
  };
})();
const UPDATE = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER,
  npmPackageName: "command-code",
  nativeUpdate: null,
});
const CommandCodeStatus = Schema.Struct({
  authenticated: Schema.Boolean,
  version: Schema.optional(Schema.String),
});
const decodeStatus = Schema.decodeOption(Schema.fromJsonString(CommandCodeStatus));
const decodeSettings = Schema.decodeSync(CommandCodeSettings);

export function parseCommandCodeStatus(stdout: string) {
  return Option.getOrUndefined(decodeStatus(stdout));
}

export function commandCodeVersionAtLeast(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && (minor > 74 || (minor === 74 && Number(match[3]) >= 0)));
}

function slashCommands(
  commands: ReadonlyArray<AcpSchema.AvailableCommand>,
): ServerProviderSlashCommand[] {
  return commands.flatMap((command) => {
    const name = command.name.trim().replace(/^\//, "");
    if (!name) return [];
    const description = command.description.trim();
    const hint = command.input?.hint?.trim();
    return [
      { name, ...(description ? { description } : {}), ...(hint ? { input: { hint } } : {}) },
    ];
  });
}

export type CommandCodeDriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const CommandCodeDriver: ProviderDriver<
  CommandCodeSettings,
  CommandCodeDriverEnv,
  Path.Path
> = {
  driverKind: DRIVER,
  metadata: {
    displayName: "Command Code",
    supportsMultipleInstances: true,
    hasDefaultInstance: false,
  },
  configSchema: CommandCodeSettings,
  usage: commandCodeUsageReader,
  defaultConfig: () => decodeSettings({}),
  create: Effect.fn("CommandCodeDriver.create")(function* (input) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const secureRandom = yield* SecureRandom.SecureRandom;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { cwd: serverCwd } = (yield* ProviderHost.ProviderHost).paths;
    const loggers = yield* ProviderEventLoggers;
    const selfInvocation = yield* resolveSelfInvocation();
    const continuationRequests = yield* ProviderContinuationRequests;
    const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
    const environment = {
      ...(yield* mergeProviderInstanceEnvironment(input.environment)),
      COMMANDCODE_SKIP_UPDATES: "1",
    };
    const settings = input.config;
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER,
      instanceId: input.instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      ...input,
      driverKind: DRIVER,
      accentColor: input.accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const stamp = (draft: Parameters<typeof stampIdentity>[0]) => ({
      ...stampIdentity(draft),
      supportsTextGeneration: false,
    });
    const driverError = (detail: string, cause: unknown) =>
      new ProviderDriverError({ driver: DRIVER, instanceId: input.instanceId, detail, cause });
    const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const initialSnapshot = Effect.gen(function* () {
      const checkedAt = yield* now;
      return stamp(
        buildServerProvider({
          presentation: PRESENTATION,
          enabled: input.enabled,
          checkedAt,
          models: [],
          probe: {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            ...(input.enabled ? { message: COMMAND_CODE_CHECKING_MESSAGE } : {}),
          },
        }),
      );
    });
    const checkProvider = Effect.gen(function* () {
      if (!input.enabled) return yield* initialSnapshot;
      const checkedAt = yield* now;
      const versionResult = yield* Effect.exit(
        spawnAndCollect(
          settings.binaryPath,
          ChildProcess.make(settings.binaryPath, ["--version"], { env: environment }),
        ),
      );
      const installed = Exit.isSuccess(versionResult) && versionResult.value.code === 0;
      const version =
        Exit.isSuccess(versionResult) && installed
          ? parseGenericCliVersion(versionResult.value.stdout)
          : null;
      const statusResult = installed
        ? yield* Effect.exit(
            spawnAndCollect(
              settings.binaryPath,
              ChildProcess.make(settings.binaryPath, ["status", "--json"], {
                cwd: serverCwd,
                env: environment,
              }),
            ),
          )
        : undefined;
      const status =
        statusResult && Exit.isSuccess(statusResult)
          ? parseCommandCodeStatus(statusResult.value.stdout)
          : undefined;
      const compatible = version !== null && commandCodeVersionAtLeast(version);
      return stamp(
        buildServerProvider({
          presentation: PRESENTATION,
          enabled: true,
          checkedAt,
          models: [],
          probe: {
            installed,
            version,
            status: !installed
              ? "error"
              : !compatible || !status?.authenticated
                ? "warning"
                : "ready",
            auth: {
              status:
                status === undefined
                  ? "unknown"
                  : status.authenticated
                    ? "authenticated"
                    : "unauthenticated",
            },
            ...(!installed
              ? {
                  message:
                    "Install Command Code with `npm install -g command-code`, then run `command-code login` on this environment's machine.",
                }
              : !compatible
                ? { message: `Command Code ${MINIMUM_VERSION} or newer is required.` }
                : status === undefined
                  ? {
                      message:
                        "Could not read Command Code sign-in status. Run `command-code status --json` on this environment's machine.",
                    }
                  : !status.authenticated
                    ? {
                        message:
                          "Run `command-code login` on this environment's machine, or set COMMAND_CODE_API_KEY on this provider instance.",
                      }
                    : {}),
          },
        }),
      );
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

    type RuntimeInput = Omit<
      CommandCodeAcpRuntimeInput,
      "settings" | "environment" | "childProcessSpawner"
    >;
    const makeRuntime = (runtimeInput: RuntimeInput) =>
      makeCommandCodeAcpRuntime({
        ...runtimeInput,
        settings,
        environment,
        childProcessSpawner: spawner,
      }).pipe(Effect.provideService(SecureRandom.SecureRandom, secureRandom));
    const discover = Effect.fn("CommandCodeDriver.discover")(function* (cwd: string) {
      const runtime = yield* makeRuntime({
        cwd,
        clientInfo: { name: "t3-code-discovery", version: "0.0.0" },
        mcpServers: [],
      });
      let commands: ServerProviderSlashCommand[] = [];
      yield* runtime.handleSessionUpdate(({ update }) =>
        Effect.sync(() => {
          if (update.sessionUpdate === "available_commands_update")
            commands = slashCommands(update.availableCommands);
        }),
      );
      const started = yield* runtime.start();
      yield* Effect.addFinalizer(() =>
        runtime
          .request("session/close", { sessionId: started.sessionId })
          .pipe(Effect.ignore, Effect.asVoid),
      );
      return {
        models: commandCodeModels(yield* runtime.getConfigOptions, started.sessionSetupResult),
        slashCommands: commands,
      };
    }, Effect.scoped);

    const snapshots = yield* SubscriptionRef.make<ServerProvider>(yield* initialSnapshot);
    const refreshLock = yield* Semaphore.make(1);
    const discoverMetadata = (base: ServerProvider, cwd: string) =>
      base.enabled && base.status === "ready" && base.auth.status === "authenticated"
        ? discover(cwd).pipe(
            Effect.mapError((cause) =>
              driverError(`Could not discover Command Code models for '${cwd}'.`, cause),
            ),
            Effect.asSome,
          )
        : Effect.succeedNone;
    const discoverForCwd = Effect.fn("discoverForCwd")(function* (cwd: string) {
      const base = yield* SubscriptionRef.get(snapshots);
      const metadata = yield* discoverMetadata(base, cwd);
      if (Option.isNone(metadata)) return base;
      const scoped = { ...base, ...metadata.value, checkedAt: yield* now };
      yield* SubscriptionRef.update(snapshots, (current) =>
        upsertProviderWorkspaceSnapshot({ ...current, models: metadata.value.models }, cwd, scoped),
      );
      return scoped;
    });
    // Publishes once, so readers never see a probed snapshot without its models.
    const refresh = refreshLock.withPermit(
      Effect.gen(function* () {
        const probed = yield* checkProvider;
        const next = yield* discoverMetadata(probed, serverCwd).pipe(
          Effect.map(
            Option.match({
              onNone: () => probed,
              onSome: (metadata) =>
                upsertProviderWorkspaceSnapshot({ ...probed, models: metadata.models }, serverCwd, {
                  ...probed,
                  ...metadata,
                }),
            }),
          ),
          Effect.catch((cause): Effect.Effect<ServerProvider> =>
            Effect.succeed({ ...probed, status: "warning", message: cause.detail }),
          ),
        );
        yield* SubscriptionRef.set(snapshots, next);
        return next;
      }),
    );
    // Instances are built one after another; probing inline would stall the rest.
    if (input.enabled) yield* Effect.forkScoped(refresh);
    const resolveMaintenance = yield* makeCachedProviderMaintenanceResolution(
      input.enabled
        ? resolveProviderMaintenanceCapabilitiesEffect(UPDATE, {
            binaryPath: settings.binaryPath,
            env: environment,
          }).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          )
        : Effect.succeed(
            makeManualOnlyProviderMaintenanceCapabilities({
              provider: DRIVER,
              packageName: "command-code",
            }),
          ),
    );
    const orchestrationAdapter = yield* makeCommandCodeAdapterV2({
      instanceId: input.instanceId,
      settings,
      environment,
      childProcessSpawner: spawner,
      secureRandom,
      selfInvocation,
      continuationRequests,
      nativeLogging: (threadId) =>
        makeNativeLogger({ nativeEventLogger: loggers.native, provider: DRIVER, threadId }),
      onConfigOptionsUpdated: (options, modelState) =>
        SubscriptionRef.update(snapshots, (current) => ({
          ...current,
          models: commandCodeModels(options, modelState ? { models: modelState } : undefined),
        })),
      onAvailableCommands: (commands, cwd) =>
        SubscriptionRef.update(snapshots, (current) =>
          upsertProviderWorkspaceSnapshot(current, cwd, {
            ...current,
            slashCommands: slashCommands(commands),
          }),
        ),
    });
    return {
      instanceId: input.instanceId,
      driverKind: DRIVER,
      continuationIdentity,
      displayName: input.displayName,
      accentColor: input.accentColor,
      enabled: input.enabled,
      orchestrationAdapter,
      textGeneration: unsupportedTextGeneration,
      snapshot: {
        getSnapshot: SubscriptionRef.get(snapshots),
        refresh,
        resolveMaintenance,
        streamChanges: SubscriptionRef.changes(snapshots),
        applyUsageLimits: () => Effect.void,
      },
      snapshotForCwd: (cwd) => refreshLock.withPermit(discoverForCwd(cwd)),
      refreshModels: () => refresh.pipe(Effect.asVoid),
    } satisfies ProviderInstance;
  }),
};
