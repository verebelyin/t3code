import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import type * as EffectAcpSchema from "effect-acp/compat";

import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { withCommandCodeTurnGuards } from "./CommandCodeAdapter.ts";
import {
  COMMAND_CODE_LOOP_THRESHOLD,
  COMMAND_CODE_PLAN_MODE_HINT,
} from "./CommandCodeLoopGuard.ts";

type Runtime = AcpSessionRuntime.AcpSessionRuntime["Service"];
type Event = AcpSessionRuntime.AcpSessionRuntimeEvent;

const text = (value: string) => ({ type: "text", text: value }) as const;

const repeatedToolCall = (index: number): Event => ({
  _tag: "ToolCallUpdated",
  toolCall: {
    toolCallId: `tool-${index}`,
    kind: "execute",
    title: "shell_command",
    status: "completed",
    data: { rawInput: { command: "true" } },
  },
  rawPayload: {},
});

/** A runtime whose prompt delivers `events` through the guarded event stream. */
function makeFakeRuntime(modeId: string) {
  const sent: Array<ReadonlyArray<EffectAcpSchema.ContentBlock>> = [];
  const state = {
    cancels: 0,
    events: [] as ReadonlyArray<Event>,
    deliver: (): Effect.Effect<void> => Effect.void,
  };
  const prompt: Runtime["prompt"] = (payload) =>
    Effect.suspend(() => {
      sent.push(payload.prompt);
      return state.deliver();
    }).pipe(Effect.as({ stopReason: "end_turn" as const }));
  const runtime = {
    cancel: Effect.sync(() => {
      state.cancels++;
    }),
    getEvents: () => Stream.suspend(() => Stream.fromIterable(state.events)),
    getModeState: Effect.succeed({ currentModeId: modeId, availableModes: [] }),
    prompt,
  };
  return { runtime, sent, state };
}

describe("withCommandCodeTurnGuards", () => {
  it.effect("fails a turn that repeats one tool call, then resets for the next turn", () =>
    Effect.gen(function* () {
      const fake = makeFakeRuntime("default");
      const guarded = yield* withCommandCodeTurnGuards(fake.runtime, {});
      fake.state.deliver = () => Stream.runDrain(guarded.getEvents());
      fake.state.events = Array.from({ length: COMMAND_CODE_LOOP_THRESHOLD }, (_, index) =>
        repeatedToolCall(index),
      );

      const looped = yield* Effect.exit(guarded.prompt({ prompt: [text("go")] }));
      expect(Exit.isFailure(looped)).toBe(true);
      expect(String(Exit.isFailure(looped) ? looped.cause : "")).toContain(
        "repeated the same tool call",
      );
      yield* Effect.yieldNow;
      expect(fake.state.cancels).toBe(1);

      fake.state.events = [repeatedToolCall(100)];
      const next = yield* guarded.prompt({ prompt: [text("again")] });
      expect(next.stopReason).toBe("end_turn");
    }),
  );

  it.effect("steers away from native plan tools only outside plan mode", () =>
    Effect.gen(function* () {
      const build = makeFakeRuntime("default");
      yield* (yield* withCommandCodeTurnGuards(build.runtime, {})).prompt({
        prompt: [text("hello")],
      });
      expect(build.sent[0]?.at(-1)).toEqual(text(COMMAND_CODE_PLAN_MODE_HINT));

      const plan = makeFakeRuntime("plan");
      yield* (yield* withCommandCodeTurnGuards(plan.runtime, {})).prompt({
        prompt: [text("hello")],
      });
      expect(plan.sent[0]).toEqual([text("hello")]);
    }),
  );

  it.effect("sends a slash command without the trailing instruction block", () =>
    Effect.gen(function* () {
      const fake = makeFakeRuntime("default");
      yield* (yield* withCommandCodeTurnGuards(fake.runtime, {})).prompt({
        prompt: [text("/compact"), text("runtime instructions")],
      });
      expect(fake.sent[0]).toEqual([text("/compact")]);
    }),
  );
});
