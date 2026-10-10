import {
  COMMAND_CODE_DRIVER_KIND,
  ProviderDriverKind,
  type CommandCodeSettings,
  type OrchestrationV2ProviderCapabilities,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import type { SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { ChildProcessSpawner } from "effect/process";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as EffectAcpErrors from "effect-acp/errors";

import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
} from "@t3tools/provider-acp/server/adapter";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { commandCodePermissionMode, makeCommandCodeAcpRuntime } from "./CommandCodeAcpSupport.ts";
import { COMMAND_CODE_PLAN_MODE_HINT, makeCommandCodeLoopGuard } from "./CommandCodeLoopGuard.ts";
import {
  commandCodeApprovalOptions,
  extractCommandCodeUserInputQuestion,
  makeCommandCodeUserInputResponse,
  normalizeCommandCodeToolCall,
} from "./CommandCodeProtocol.ts";

export const COMMAND_CODE_PROVIDER = ProviderDriverKind.make(COMMAND_CODE_DRIVER_KIND);

const CommandCodeProviderCapabilitiesV2 = {
  ...AcpProviderCapabilitiesV2,
  sessions: {
    ...AcpProviderCapabilitiesV2.sessions,
    supportsModelSwitchInSession: true,
  },
  tools: {
    ...AcpProviderCapabilitiesV2.tools,
    supportsMcpTools: true,
  },
} satisfies OrchestrationV2ProviderCapabilities;

const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

type Runtime = AcpSessionRuntime.AcpSessionRuntime["Service"];
type GuardedRuntime = Pick<Runtime, "cancel" | "getEvents" | "getModeState" | "prompt">;

/**
 * Adds Command Code's per-session turn behavior to a runtime: slash-command
 * catalogs scoped to the session's workspace, a plan-mode steer outside plan
 * mode, and a loop guard that fails a turn stuck repeating one tool call.
 */
export const withCommandCodeTurnGuards = Effect.fnUntraced(function* <R extends GuardedRuntime>(
  runtime: R,
  input: {
    readonly onAvailableCommands?: (
      commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
    ) => Effect.Effect<void>;
  },
) {
  const scope = yield* Effect.scope;
  const loopGuard = makeCommandCodeLoopGuard();
  let loopAbort: string | undefined;
  const observe = (event: AcpSessionRuntime.AcpSessionRuntimeEvent) => {
    if (event._tag === "AvailableCommandsUpdated") {
      return input.onAvailableCommands?.(event.availableCommands) ?? Effect.void;
    }
    if (event._tag !== "ToolCallUpdated" || loopAbort !== undefined) return Effect.void;
    const reason = loopGuard.observe(normalizeCommandCodeToolCall(event.toolCall));
    if (reason === undefined) return Effect.void;
    loopAbort = reason;
    // Cancelling waits for the prompt, which is still delivering this event.
    return Effect.ignore(runtime.cancel).pipe(Effect.forkIn(scope), Effect.asVoid);
  };
  const prompt: Runtime["prompt"] = (payload, options) =>
    Effect.gen(function* () {
      loopGuard.reset();
      loopAbort = undefined;
      const [first] = payload.prompt;
      const slashCommand = first?.type === "text" && first.text.trimStart().startsWith("/");
      const modeState = yield* runtime.getModeState;
      // Command Code reads a slash command only when it is the whole prompt,
      // so the trailing T3 instruction block is dropped for those turns.
      const blocks = slashCommand
        ? payload.prompt.slice(0, payload.prompt.length > 1 ? -1 : undefined)
        : modeState?.currentModeId === "plan"
          ? payload.prompt
          : [...payload.prompt, { type: "text" as const, text: COMMAND_CODE_PLAN_MODE_HINT }];
      const result = yield* runtime.prompt({ ...payload, prompt: blocks }, options);
      if (loopAbort !== undefined) {
        return yield* EffectAcpErrors.AcpRequestError.internalError(loopAbort);
      }
      return result;
    });
  return {
    ...runtime,
    getEvents: () => runtime.getEvents().pipe(Stream.tap(observe)),
    prompt,
  };
});

export interface CommandCodeAdapterV2Options {
  readonly instanceId: ProviderInstanceId;
  readonly settings: CommandCodeSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly crypto: Crypto.Crypto;
  readonly selfInvocation: SelfInvocation;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  readonly onAvailableCommands?: (
    commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
    cwd: string,
  ) => Effect.Effect<void>;
  readonly onConfigOptionsUpdated?: (
    configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  ) => Effect.Effect<void>;
}

export function makeCommandCodeAcpAdapterFlavor(
  options: CommandCodeAdapterV2Options,
): AcpAdapterV2Flavor {
  return {
    driver: COMMAND_CODE_PROVIDER,
    runtimeHarness: "CommandCode",
    capabilities: CommandCodeProviderCapabilitiesV2,
    // The CLI accepts image blocks; the old adapter always sent them.
    supportsImagePrompts: true,
    makeRuntime: ({ runtimePolicy: _runtimePolicy, processEnvironment, ...input }) =>
      makeCommandCodeAcpRuntime({
        ...input,
        settings: options.settings,
        environment: { ...options.environment, ...processEnvironment },
        childProcessSpawner: options.childProcessSpawner,
      }).pipe(
        Effect.flatMap((runtime) =>
          withCommandCodeTurnGuards(runtime, {
            onAvailableCommands: (commands) =>
              options.onAvailableCommands?.(commands, input.cwd) ?? Effect.void,
          }),
        ),
        Effect.provideService(Crypto.Crypto, options.crypto),
      ),
    sessionModeForPolicy: (policy) => commandCodePermissionMode(policy.runtimeMode),
    onSessionConfigurationUpdate: (configOptions) =>
      options.onConfigOptionsUpdated?.(configOptions) ?? Effect.void,
    approvalOptions: commandCodeApprovalOptions,
    extractPermissionQuestion: (request) => {
      const question = extractCommandCodeUserInputQuestion(request);
      return question === undefined
        ? undefined
        : { question, respond: (answers) => makeCommandCodeUserInputResponse(request, answers) };
    },
    normalizeToolCall: normalizeCommandCodeToolCall,
    promptFailure: (cause) =>
      makeProviderFailure({
        cause,
        ...(isAcpRequestError(cause)
          ? { message: cause.errorMessage, code: String(cause.code) }
          : {}),
        class: "provider_error",
      }),
  };
}

export function makeCommandCodeAdapterV2(options: CommandCodeAdapterV2Options) {
  return makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeCommandCodeAcpAdapterFlavor(options),
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
  });
}
