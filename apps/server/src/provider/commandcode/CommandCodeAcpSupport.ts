import {
  type CommandCodeSettings,
  type RuntimeMode,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import type { AcpSpawnInput } from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { normalizeCommandCodeSessionUpdate } from "./CommandCodeProtocol.ts";

export function buildCommandCodeSpawnInput(
  settings: CommandCodeSettings,
  cwd: string,
  environment?: NodeJS.ProcessEnv,
): AcpSpawnInput {
  return {
    command: settings.binaryPath,
    args: ["acp"],
    cwd,
    env: { ...environment, COMMANDCODE_SKIP_UPDATES: "1" },
  };
}

export interface CommandCodeAcpRuntimeInput extends Omit<
  AcpSessionRuntime.AcpSessionRuntimeOptions,
  "spawn" | "authMethodId" | "cancelBehavior" | "resumeMethod" | "transformSessionUpdate"
> {
  readonly settings: CommandCodeSettings;
  readonly environment?: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}

export const makeCommandCodeAcpRuntime = Effect.fn("makeCommandCodeAcpRuntime")(function* (
  input: CommandCodeAcpRuntimeInput,
): Effect.fn.Return<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  EffectAcpErrors.AcpError,
  Crypto.Crypto | Scope.Scope
> {
  const context = yield* Layer.build(
    AcpSessionRuntime.layer({
      ...input,
      spawn: {
        ...buildCommandCodeSpawnInput(input.settings, input.cwd, input.environment),
      },
      authMethodId: "command-code-cli",
      resumeMethod: "resume",
      cancelBehavior: "wait-for-prompt",
      transformSessionUpdate: normalizeCommandCodeSessionUpdate,
    }).pipe(
      Layer.provide(
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
      ),
    ),
  );
  return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(Effect.provide(context));
});

export function commandCodePermissionMode(runtimeMode: RuntimeMode): string {
  switch (runtimeMode) {
    case "auto-accept-edits":
      return "auto-accept";
    case "full-access":
      return "bypass";
    case "approval-required":
    case "auto":
      return "default";
  }
}

function optionValues(
  option: EffectAcpSchema.SessionConfigOption,
): ReadonlyArray<EffectAcpSchema.SessionConfigSelectOption> {
  if (option.type !== "select") return [];
  return option.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options));
}

function optionDescriptor(option: EffectAcpSchema.SessionConfigOption) {
  if (option.type !== "select") return undefined;
  return {
    id: option.id,
    label: option.name,
    type: "select" as const,
    currentValue: option.currentValue,
    options: optionValues(option).map((value) => ({
      id: value.value,
      label: value.name,
      ...(value.description ? { description: value.description } : {}),
      ...(value.value === option.currentValue ? { isDefault: true } : {}),
    })),
  };
}

export function commandCodeModels(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  sessionSetup?:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): ReadonlyArray<ServerProviderModel> {
  const modelOption = configOptions.find(
    (option) => option.id === "model" || option.category === "model",
  );
  const nativeModels = sessionSetup?.models?.availableModels ?? [];
  const values = modelOption?.type === "select" ? optionValues(modelOption) : [];
  const entries =
    values.length > 0
      ? values.map((value) => ({ slug: value.value, name: value.name }))
      : nativeModels.map((value) => ({
          slug: value.modelId,
          name: value.name,
        }));
  const effort = configOptions.find(
    (option) =>
      option.id === "effort" ||
      option.id === "thought_level" ||
      option.category === "thought_level",
  );
  const effortDescriptor = effort ? optionDescriptor(effort) : undefined;
  const currentModel =
    modelOption?.type === "select"
      ? modelOption.currentValue
      : sessionSetup?.models?.currentModelId;
  return entries
    .filter((entry) => entry.slug.trim().length > 0)
    .map(
      (entry) =>
        ({
          slug: entry.slug,
          name: entry.name.trim() || entry.slug,
          isCustom: false,
          ...(entry.slug === currentModel ? { isDefault: true } : {}),
          capabilities:
            effortDescriptor && entry.slug === currentModel
              ? { optionDescriptors: [effortDescriptor] }
              : null,
        }) satisfies ServerProviderModel,
    );
}
