import { describe, expect, it } from "@effect/vitest";
import * as NodeURL from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as TestProviderHost from "@t3tools/provider-testing/TestProviderHost";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import {
  NoOpProviderEventLoggers,
  ProviderEventLoggers,
} from "@t3tools/provider-core/server/ProviderEventLoggers";
import {
  CommandCodeDriver,
  commandCodeVersionAtLeast,
  parseCommandCodeStatus,
} from "./CommandCodeDriver.ts";

const fixture = NodeURL.fileURLToPath(
  new URL("./fixtures/commandcode-acp-peer.ts", import.meta.url),
);

function checkInstance(input: {
  readonly enabled?: boolean;
  readonly binaryPath?: string;
  readonly environment?: Record<string, string>;
}) {
  return Effect.gen(function* () {
    const nativeSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const calls: Array<{
      readonly args: ReadonlyArray<string>;
      readonly environment: NodeJS.ProcessEnv;
    }> = [];
    let processesReleased = 0;
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        if (!ChildProcess.isStandardCommand(command)) return yield* nativeSpawner.spawn(command);
        calls.push({ args: command.args, environment: command.options.env ?? {} });
        const handle = yield* nativeSpawner.spawn(
          command.command === "command-code-test"
            ? ChildProcess.make(process.execPath, [fixture, ...command.args], command.options)
            : command,
        );
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            processesReleased++;
          }),
        );
        return handle;
      }),
    );
    const provider = yield* CommandCodeDriver.create({
      instanceId: ProviderInstanceId.make("commandcode-test"),
      displayName: "Work account",
      environment: Object.entries(input.environment ?? {}).map(([name, value]) => ({
        name,
        value,
        sensitive: false,
      })),
      enabled: input.enabled ?? true,
      config: { binaryPath: input.binaryPath ?? "command-code-test" },
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
    const initial = yield* provider.snapshot.getSnapshot;
    const scoped = provider.snapshotForCwd
      ? yield* provider.snapshotForCwd(process.cwd())
      : undefined;
    const refreshed = yield* provider.snapshot.refresh;
    return { initial, scoped, refreshed, calls, processesReleased };
  }).pipe(
    Effect.scoped,
    Effect.provideService(ProviderEventLoggers, NoOpProviderEventLoggers),
    Effect.provide(
      TestProviderHost.layer({ cwd: process.cwd(), runBackgroundWork: false }).pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(IdAllocator.layer),
        Layer.provideMerge(McpProviderSessions.layer),
      ),
    ),
  );
}

describe("Command Code driver version gate", () => {
  it("accepts ACP versions at or above 1.74.0", () => {
    expect(commandCodeVersionAtLeast("1.74.0")).toBe(true);
    expect(commandCodeVersionAtLeast("1.74.1")).toBe(true);
    expect(commandCodeVersionAtLeast("2.0.0")).toBe(true);
  });

  it("rejects versions before ACP support", () => {
    expect(commandCodeVersionAtLeast("1.73.9")).toBe(false);
    expect(commandCodeVersionAtLeast("1.0.0")).toBe(false);
  });

  it("does not infer authentication from malformed or logged-out status output", () => {
    expect(parseCommandCodeStatus('{"authenticated":false,"version":"1.74.0"}')).toEqual({
      authenticated: false,
      version: "1.74.0",
    });
    expect(parseCommandCodeStatus("not json")).toBeUndefined();
    expect(parseCommandCodeStatus('{"version":"1.74.0"}')).toBeUndefined();
  });
});

describe("Command Code driver lifecycle", () => {
  it.effect("disabled instances never start a process or discover models", () =>
    Effect.gen(function* () {
      const result = yield* checkInstance({ enabled: false });
      expect(result.calls).toEqual([]);
      expect(result.initial.status).toBe("disabled");
      expect(result.refreshed.models).toEqual([]);
    }),
  );

  it.effect("a missing executable reports setup guidance and skips discovery", () =>
    Effect.gen(function* () {
      const result = yield* checkInstance({ binaryPath: "/t3-command-code-missing/binary" });
      expect(result.initial.installed).toBe(false);
      expect(result.initial.status).toBe("error");
      expect(result.initial.message).toContain("npm install -g command-code");
      expect(result.calls.every((call) => call.args[0] === "--version")).toBe(true);
    }),
  );

  it.effect("logged-out status exit 1 remains usable setup metadata without ACP sessions", () =>
    Effect.gen(function* () {
      const result = yield* checkInstance({ environment: { T3_COMMANDCODE_TEST_AUTH: "false" } });
      expect(result.initial.auth.status).toBe("unauthenticated");
      expect(result.initial.message).toContain("command-code login");
      expect(result.calls.some((call) => call.args[0] === "acp")).toBe(false);
    }),
  );

  it.effect("incompatible CLIs do not attempt ACP", () =>
    Effect.gen(function* () {
      const result = yield* checkInstance({
        environment: { T3_COMMANDCODE_TEST_VERSION: "1.73.9" },
      });
      expect(result.initial.message).toContain("1.74.0");
      expect(result.calls.some((call) => call.args[0] === "acp")).toBe(false);
    }),
  );

  it.effect("publishes the native catalog and closes every discovery process", () =>
    Effect.gen(function* () {
      const result = yield* checkInstance({
        environment: { COMMAND_CODE_API_KEY: "isolated-test-key" },
      });
      expect(result.initial.models.map((model) => model.slug)).toEqual(["fake-model"]);
      expect(result.refreshed.models.map((model) => model.slug)).toEqual(["fake-model"]);
      expect(result.initial.supportsTextGeneration).toBe(false);
      expect(result.initial.instanceId).toBe("commandcode-test");
      expect(result.processesReleased).toBe(result.calls.length);
      expect(result.calls.every((call) => call.environment.COMMANDCODE_SKIP_UPDATES === "1")).toBe(
        true,
      );
      expect(
        result.calls.every((call) => call.environment.COMMAND_CODE_API_KEY === "isolated-test-key"),
      ).toBe(true);
    }),
  );
});
