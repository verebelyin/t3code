import type {
  ProviderApprovalDecision,
  ProviderApprovalOption,
  ProviderUserInputAnswers,
  UserInputQuestion,
} from "@t3tools/contracts";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as AcpWireSchema from "effect-acp/schema-v1";

import type { AcpToolCallState } from "@t3tools/provider-acp/server/runtimeModel";

const TOOL_TEXT_LIMIT = 8_000;
export const COMMAND_CODE_TOOL_TEXT_TRUNCATED = "[Earlier output truncated]\n\n";
const QUESTION_LABEL_LIMIT = 512;

const NativeToolFields = Schema.Struct({
  command: Schema.optional(Schema.String),
  CommandLine: Schema.optional(Schema.String),
  command_line: Schema.optional(Schema.String),
  commandLine: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  Cwd: Schema.optional(Schema.String),
  WorkingDirectory: Schema.optional(Schema.String),
  working_dir: Schema.optional(Schema.String),
  workingDir: Schema.optional(Schema.String),
  combinedOutput: Schema.optional(Schema.String),
  combined_output: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Int),
  exit_code: Schema.optional(Schema.Int),
  imagePath: Schema.optional(Schema.String),
});
const isJsonRecord = Schema.is(Schema.Record(Schema.String, Schema.Json));
const decodeNativeToolFields = Schema.decodeUnknownOption(NativeToolFields);
const decodeSingleAnswer = Schema.decodeUnknownOption(
  Schema.Union([Schema.String, Schema.Tuple([Schema.String])]),
);
const decodeToolCallContent = Schema.decodeUnknownOption(AcpWireSchema.ToolCallContent);
const decodeQuestionInput = Schema.decodeUnknownOption(
  Schema.Struct({
    question: Schema.NonEmptyString,
    options: Schema.Array(Schema.NonEmptyString),
  }),
);

/** Native questions share the permission method, but their choices are not approvals. */
export function isCommandCodeUserInputRequest(
  request: EffectAcpSchema.RequestPermissionRequest,
): boolean {
  return Option.isSome(decodeQuestionInput(request.toolCall.rawInput));
}

export function selectCommandCodePermissionOptionId(
  request: EffectAcpSchema.RequestPermissionRequest,
  decision: ProviderApprovalDecision,
): string | undefined {
  if (decision === "cancel" || isCommandCodeUserInputRequest(request)) {
    return undefined;
  }
  const kind =
    decision === "accept" ? "allow_once" : decision === "decline" ? "reject_once" : "allow_always";
  const option = request.options.find((entry) => entry.kind === kind);
  return option?.optionId.trim() ? option.optionId : undefined;
}

/** Only advertise decisions that the native request can honor. */
export function commandCodeApprovalOptions(
  request: EffectAcpSchema.RequestPermissionRequest,
): ReadonlyArray<ProviderApprovalOption> {
  if (isCommandCodeUserInputRequest(request)) return [];
  const options: ProviderApprovalOption[] = [];
  const optionWithKind = (kind: EffectAcpSchema.PermissionOption["kind"]) =>
    request.options.find((entry) => entry.kind === kind && entry.optionId.trim());
  const once = optionWithKind("allow_once");
  if (once) {
    options.push({ decision: "accept", label: "Allow once" });
  }
  const always = optionWithKind("allow_always");
  if (always) {
    options.push({
      decision: "acceptForSession",
      label: "Allow for this thread",
    });
  }
  if (optionWithKind("reject_once")) {
    options.push({ decision: "decline", label: "Deny" });
  }
  options.push({ decision: "cancel", label: "Cancel" });
  return options;
}

function copyBoundedText(text: string): string {
  return Buffer.from(text, "utf16le").toString("utf16le");
}

function questionLabel(option: EffectAcpSchema.PermissionOption): string {
  const label = option.name.trim() || option.optionId;
  return label.length > QUESTION_LABEL_LIMIT
    ? copyBoundedText(`${label.slice(0, QUESTION_LABEL_LIMIT - 3)}...`)
    : label;
}

export function extractCommandCodeUserInputQuestion(
  request: EffectAcpSchema.RequestPermissionRequest,
): UserInputQuestion | undefined {
  if (!isCommandCodeUserInputRequest(request) || request.options.length === 0) {
    return undefined;
  }
  const ids = new Set<string>();
  for (const option of request.options) {
    if (!option.optionId.trim() || ids.has(option.optionId)) {
      return undefined;
    }
    ids.add(option.optionId);
  }
  const nativeInput = Option.getOrUndefined(decodeQuestionInput(request.toolCall.rawInput));
  if (!nativeInput) return undefined;
  const question = nativeInput.question.trim();
  return {
    id: request.toolCall.toolCallId,
    header: "Question",
    question:
      question.length > TOOL_TEXT_LIMIT
        ? copyBoundedText(`${question.slice(0, TOOL_TEXT_LIMIT - 3)}...`)
        : question,
    multiSelect: false,
    allowCustomAnswer: false,
    options: request.options.map((option, index) => ({
      value: option.optionId,
      label: nativeInput.options[index] ?? questionLabel(option),
      description: questionLabel(option),
    })),
  };
}

/** Return undefined for an invalid answer so the adapter keeps the question open. */
export function makeCommandCodeUserInputResponse(
  request: EffectAcpSchema.RequestPermissionRequest,
  answers: ProviderUserInputAnswers,
): EffectAcpSchema.RequestPermissionResponse | undefined {
  if (extractCommandCodeUserInputQuestion(request) === undefined) {
    return undefined;
  }
  const answer = Option.getOrUndefined(decodeSingleAnswer(answers[request.toolCall.toolCallId]));
  const value = typeof answer === "string" ? answer : answer?.[0];
  if (value === undefined) {
    return undefined;
  }
  const exact = request.options.find((option) => option.optionId === value);
  if (exact) {
    return { outcome: { outcome: "selected", optionId: exact.optionId } };
  }
  const matchingLabels = request.options.filter((option) => questionLabel(option) === value);
  const option = matchingLabels.length === 1 ? matchingLabels[0] : undefined;
  return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : undefined;
}

function boundText(text: string, limit = TOOL_TEXT_LIMIT): string {
  return text.length <= limit
    ? text
    : copyBoundedText(`${COMMAND_CODE_TOOL_TEXT_TRUNCATED}${text.slice(-limit)}`);
}

interface ToolPayloadBudget {
  nodes: number;
  text: number;
}

function sanitizeToolValue(value: unknown, budget: ToolPayloadBudget, depth: number): unknown {
  if (depth > 12 || budget.nodes-- <= 0) {
    return undefined;
  }
  if (typeof value === "string") {
    if (/^data:image\//i.test(value) || budget.text <= 0) {
      return undefined;
    }
    const text = boundText(value, Math.min(TOOL_TEXT_LIMIT, budget.text));
    budget.text -= text.length;
    return text;
  }
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const entry of value) {
      if (budget.nodes <= 0) break;
      const sanitized = sanitizeToolValue(entry, budget, depth + 1);
      if (sanitized !== undefined) result.push(sanitized);
    }
    return result;
  }
  if (!Predicate.isObject(value)) {
    return value;
  }
  const entries: Array<readonly [string, unknown]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (budget.nodes <= 0) break;
    if (
      (value.type === "image" && (key === "data" || key === "blob")) ||
      (key === "blob" &&
        typeof value.mimeType === "string" &&
        value.mimeType.startsWith("image/")) ||
      ((key === "formatted_output" || key === "formattedOutput") &&
        (entry === value.combinedOutput || entry === value.combined_output))
    ) {
      continue;
    }
    const sanitized = sanitizeToolValue(entry, budget, depth + 1);
    if (sanitized !== undefined) entries.push([key, sanitized]);
  }
  return Object.fromEntries(entries);
}

/** Bound both retained raw events and display data before they enter the event stream. */
export function sanitizeCommandCodeToolPayload(payload: unknown): unknown {
  return sanitizeToolValue(payload, { nodes: 512, text: 64_000 }, 0);
}

/** The runtime uses this before it retains tool state or dispatches raw callbacks. */
export function normalizeCommandCodeSessionUpdate(
  notification: EffectAcpSchema.SessionNotification,
): EffectAcpSchema.SessionNotification {
  const update = notification.update;
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return notification;
  }
  const contentBudget = { nodes: 512, text: 32_000 };
  const content = update.content?.flatMap((entry) => {
    const decoded = Option.getOrUndefined(
      decodeToolCallContent(sanitizeToolValue(entry, contentBudget, 0)),
    );
    return decoded === undefined ? [] : [decoded];
  });
  const meta = sanitizeCommandCodeToolPayload(update._meta);
  return {
    ...notification,
    update: {
      ...update,
      ...(typeof update.title === "string" ? { title: boundText(update.title) } : {}),
      ...(update.rawInput !== undefined
        ? { rawInput: sanitizeCommandCodeToolPayload(update.rawInput) }
        : {}),
      ...(update.rawOutput !== undefined
        ? { rawOutput: sanitizeCommandCodeToolPayload(update.rawOutput) }
        : {}),
      ...(update.content !== undefined ? { content: content ?? [] } : {}),
      ...(update._meta !== undefined ? { _meta: isJsonRecord(meta) ? meta : null } : {}),
    },
  };
}

function localImagePath(imagePath: string | undefined): string | undefined {
  if (!imagePath || imagePath.length > TOOL_TEXT_LIMIT) {
    return undefined;
  }
  const path = imagePath.trim();
  if (!isWorkspaceImagePreviewPath(path)) {
    return undefined;
  }
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname && url.hostname !== "localhost") return undefined;
      const pathname = decodeURIComponent(url.pathname);
      return /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      return undefined;
    }
  }
  return /^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path) ? undefined : path;
}

export function normalizeCommandCodeToolCall(toolCall: AcpToolCallState): AcpToolCallState {
  const input = Option.getOrUndefined(decodeNativeToolFields(toolCall.data.rawInput));
  const output = Option.getOrUndefined(decodeNativeToolFields(toolCall.data.rawOutput));
  const nativeCommand =
    input?.CommandLine ??
    input?.command_line ??
    input?.commandLine ??
    input?.command ??
    output?.commandLine ??
    output?.command_line ??
    toolCall.command;
  const command = nativeCommand?.trim() ? boundText(nativeCommand.trim()) : undefined;
  const nativeCwd =
    input?.Cwd ??
    input?.WorkingDirectory ??
    input?.working_dir ??
    input?.workingDir ??
    input?.cwd ??
    output?.workingDir ??
    output?.working_dir;
  const cwd = nativeCwd?.trim() ? boundText(nativeCwd.trim()) : undefined;
  const nativeOutput = output?.combinedOutput ?? output?.combined_output;
  const aggregatedOutput = nativeOutput === undefined ? undefined : boundText(nativeOutput);
  const exitCode = output?.exitCode ?? output?.exit_code;
  const imagePath = localImagePath(output?.imagePath);
  const sanitizedData = sanitizeCommandCodeToolPayload(toolCall.data);
  const data: Record<string, unknown> = Predicate.isObject(sanitizedData) ? sanitizedData : {};
  const kind = toolCall.kind ?? (command !== undefined ? "execute" : undefined);
  if (kind !== undefined) data.kind = kind;
  if (command !== undefined) data.command = command;
  if (cwd !== undefined) data.cwd = cwd;
  if (imagePath !== undefined) data.imagePath = imagePath;
  if (kind === "execute") {
    data.item = {
      ...(Predicate.isObject(data.item) ? data.item : {}),
      ...(command !== undefined ? { command } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(aggregatedOutput !== undefined ? { aggregatedOutput } : {}),
      ...(exitCode !== undefined ? { exitCode } : {}),
    };
  }
  return {
    ...toolCall,
    ...(kind !== undefined ? { kind } : {}),
    ...(command !== undefined ? { command } : {}),
    ...(toolCall.title !== undefined ? { title: boundText(toolCall.title) } : {}),
    ...(command !== undefined
      ? { detail: command }
      : toolCall.detail !== undefined
        ? { detail: boundText(toolCall.detail) }
        : {}),
    data,
  };
}
