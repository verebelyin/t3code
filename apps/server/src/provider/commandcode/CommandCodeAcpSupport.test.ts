import { describe, expect, it } from "@effect/vitest";

import {
  buildCommandCodeSpawnInput,
  commandCodePermissionMode,
  commandCodeModels,
} from "./CommandCodeAcpSupport.ts";
import { CommandCodeSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type * as AcpSchema from "effect-acp/compat";

const decodeCommandCodeSettings = Schema.decodeSync(CommandCodeSettings);

describe("Command Code ACP support", () => {
  it("builds the managed ACP spawn command", () => {
    expect(
      buildCommandCodeSpawnInput(decodeCommandCodeSettings({}), "/tmp/project", {
        PATH: "/bin",
      }),
    ).toEqual({
      command: "command-code",
      args: ["acp"],
      cwd: "/tmp/project",
      env: { PATH: "/bin", COMMANDCODE_SKIP_UPDATES: "1" },
    });
  });

  it("maps T3 permission modes to native modes", () => {
    expect(commandCodePermissionMode("approval-required")).toBe("default");
    expect(commandCodePermissionMode("auto")).toBe("default");
    expect(commandCodePermissionMode("auto-accept-edits")).toBe("auto-accept");
    expect(commandCodePermissionMode("full-access")).toBe("bypass");
  });

  it("keeps the native current model as the default and scopes effort to it", () => {
    const configOptions = [
      {
        type: "select",
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "model-b",
        options: [
          { value: "model-a", name: "Model A" },
          { value: "model-b", name: "Model B" },
        ],
      },
      {
        type: "select",
        id: "effort",
        name: "Effort",
        category: "thought_level",
        currentValue: "high",
        options: [{ value: "high", name: "High" }],
      },
    ] satisfies ReadonlyArray<AcpSchema.SessionConfigOption>;
    const models = commandCodeModels(configOptions);
    expect(models.find((model) => model.slug === "model-a")?.isDefault).toBeUndefined();
    expect(models.find((model) => model.slug === "model-b")?.isDefault).toBe(true);
    expect(models.find((model) => model.slug === "model-a")?.capabilities).toBeNull();
    expect(models.find((model) => model.slug === "model-b")?.capabilities).toBeDefined();
  });
});
