import {
  COMMAND_CODE_DRIVER_KIND,
  type CommandCodeSettings,
  type RuntimeMode,
  type ServerProviderModel,
  type ToolInvocation,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as AcpWireSchema from "effect-acp/schema-v1";

import * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import type { AcpToolCallState } from "@t3tools/provider-acp/server/runtimeModel";
import type { AcpSpawnInput } from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { buildUnifiedHunk } from "../unifiedHunk.ts";
import {
  COMMAND_CODE_TOOL_TEXT_TRUNCATED,
  normalizeCommandCodeSessionUpdate,
} from "./CommandCodeProtocol.ts";

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

const TOOL_TEXT_LIMIT = 8_000;

function stringField(
  data: Record<string, unknown>,
  ...keys: ReadonlyArray<string>
): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function nativeRecord(value: unknown): Record<string, unknown> | undefined {
  return Predicate.isObject(value) ? value : undefined;
}

function boundedText(value: string): {
  readonly text: string;
  readonly truncated: boolean;
} {
  if (value.length <= TOOL_TEXT_LIMIT) return { text: value, truncated: false };
  const start = value.length - TOOL_TEXT_LIMIT;
  const newline = value.indexOf("\n", start);
  return {
    text: newline < 0 ? value.slice(start) : value.slice(newline + 1),
    truncated: true,
  };
}

function boundedLabel(value: string): string {
  const collapsed = value.replaceAll(/\s+/g, " ").trim();
  return collapsed.length <= 200 ? collapsed : `${collapsed.slice(0, 199)}…`;
}

const decodeToolCallContent = Schema.decodeUnknownOption(AcpWireSchema.ToolCallContent);

function toolTextContent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value.flatMap((entry) => {
    const decoded = Option.getOrUndefined(decodeToolCallContent(entry));
    return decoded?.type === "content" && decoded.content.type === "text"
      ? [decoded.content.text]
      : [];
  });
  return text.length > 0 ? text.join("\n") : undefined;
}

export function commandCodeToolInvocation(toolCall: AcpToolCallState): ToolInvocation | undefined {
  const rawInput = nativeRecord(toolCall.data.rawInput);
  const rawOutput = nativeRecord(toolCall.data.rawOutput);
  const item = nativeRecord(toolCall.data.item);
  const rawName =
    stringField(toolCall.data, "tool", "name") ?? toolCall.title?.trim() ?? toolCall.kind?.trim();
  const name = rawName ? boundedLabel(rawName) : undefined;
  if (!name) return undefined;
  const command =
    stringField(rawInput ?? {}, "CommandLine", "command_line", "commandLine", "command") ??
    stringField(rawOutput ?? {}, "CommandLine", "command_line", "commandLine", "command") ??
    stringField(item ?? {}, "command") ??
    toolCall.command;
  const path =
    stringField(rawInput ?? {}, "path", "file", "filePath", "file_path") ??
    stringField(toolCall.data, "path", "file", "filePath", "file_path");
  const pattern =
    stringField(rawInput ?? {}, "pattern", "include") ?? stringField(toolCall.data, "pattern");
  const url = stringField(rawInput ?? {}, "url") ?? stringField(toolCall.data, "url");
  const target = path ?? pattern ?? url ?? command;
  const rawOutputText =
    typeof toolCall.data.rawOutput === "string"
      ? toolCall.data.rawOutput
      : (stringField(rawOutput ?? {}, "combinedOutput", "combined_output", "output", "content") ??
        stringField(item ?? {}, "aggregatedOutput") ??
        stringField(toolCall.data, "output", "content") ??
        toolTextContent(toolCall.data.content));
  const output = rawOutputText === undefined ? undefined : boundedText(rawOutputText);
  const targetKind = path
    ? "path"
    : pattern
      ? "pattern"
      : url
        ? "url"
        : command
          ? "command"
          : undefined;
  const exitCodeValue =
    rawOutput?.exitCode ?? rawOutput?.exit_code ?? item?.exitCode ?? item?.exit_code;
  const exitCode =
    typeof exitCodeValue === "number" && Number.isInteger(exitCodeValue)
      ? exitCodeValue
      : undefined;
  const changes: Array<{
    readonly path: string;
    readonly diff?: string;
    readonly diffTruncated?: boolean;
  }> = [];
  const oldText = stringField(rawInput ?? {}, "old_string", "oldText");
  const newText = stringField(rawInput ?? {}, "new_string", "newText", "content");
  const writeFile =
    toolCall.title?.trim() === "write_file" || (toolCall.kind === "edit" && oldText === undefined);
  const diffOldText = oldText ?? (writeFile ? "" : undefined);
  if (path && diffOldText !== undefined && newText !== undefined) {
    const hunk = buildUnifiedHunk(diffOldText, newText, {
      maxLines: 1_000,
      maxChars: 48_000,
    });
    if (hunk)
      changes.push({
        path: boundedLabel(path),
        diff: hunk.diff,
        ...(hunk.truncated ||
        diffOldText.startsWith(COMMAND_CODE_TOOL_TEXT_TRUNCATED) ||
        newText.startsWith(COMMAND_CODE_TOOL_TEXT_TRUNCATED)
          ? { diffTruncated: true }
          : {}),
      });
  }
  return {
    name,
    ...(target ? { target, ...(targetKind ? { targetKind } : {}) } : {}),
    ...(changes.length > 0 ? { changes } : {}),
    ...(output
      ? {
          output: output.text,
          ...(output.truncated ? { outputTruncated: true } : {}),
        }
      : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

export { COMMAND_CODE_DRIVER_KIND };
