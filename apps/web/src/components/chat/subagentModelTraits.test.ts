import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatSubagentTokenBreakdown,
  formatSubagentTokens,
  resolveSubagentModelTraits,
  summarizeSubagentModels,
} from "./subagentModelTraits";

const instanceId = ProviderInstanceId.make("commandcode_command");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("commandcode"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-10T00:00:00.000Z",
  models: [
    {
      slug: "deepseek/deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            currentValue: "high",
            options: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
          },
        ],
      },
    },
    { slug: "moonshotai/Kimi-K3", name: "Kimi K3", isCustom: false, capabilities: null },
  ],
  slashCommands: [],
  skills: [],
};
const base = { providerInstanceId: instanceId, origin: "app_owned" as const, provider };

describe("resolveSubagentModelTraits", () => {
  it("reports the recorded effort", () => {
    const traits = resolveSubagentModelTraits({
      ...base,
      model: "deepseek/deepseek-v4.1-flash",
      modelSelection: {
        instanceId,
        model: "deepseek/deepseek-v4.1-flash",
        options: [{ id: "effort", value: "low" }],
      },
    });
    expect(traits.modelLabel).toBe("DeepSeek V4.1 Flash");
    expect(traits.effort).toBe("Low");
  });

  it("falls back to the model's default effort when none was recorded", () => {
    expect(
      resolveSubagentModelTraits({ ...base, model: "deepseek/deepseek-v4.1-flash" }).effort,
    ).toBe("High");
  });

  it("reports no effort for a model without one", () => {
    expect(resolveSubagentModelTraits({ ...base, model: "moonshotai/Kimi-K3" }).effort).toBe(
      undefined,
    );
  });
});

describe("summarizeSubagentModels", () => {
  it("names one shared model and counts mixed ones", () => {
    const flash = { ...base, model: "deepseek/deepseek-v4.1-flash" };
    expect(summarizeSubagentModels([flash, flash])).toBe("DeepSeek V4.1 Flash · High");
    expect(summarizeSubagentModels([flash, { ...base, model: "moonshotai/Kimi-K3" }])).toBe(
      "2 models",
    );
    expect(summarizeSubagentModels([{ ...base, model: null }])).toBeNull();
  });
});

describe("subagent token labels", () => {
  it("compacts totals and marks approximate readings", () => {
    expect(formatSubagentTokens({ totalTokens: 950, approximate: false })).toBe("950 tok");
    expect(formatSubagentTokens({ totalTokens: 42_130, approximate: false })).toBe("42k tok");
    expect(formatSubagentTokens({ totalTokens: 4_200, approximate: true })).toBe("~4.2k tok");
    expect(formatSubagentTokens({ totalTokens: 1_500_000, approximate: false })).toBe("1.5m tok");
  });

  it("breaks down input, output, and cached tokens when known", () => {
    expect(
      formatSubagentTokenBreakdown({
        totalTokens: 1_800,
        inputTokens: 1_500,
        outputTokens: 300,
        cachedInputTokens: 600,
        approximate: false,
      }),
    ).toBe("in 1.5k · out 300 · cached 600");
    expect(formatSubagentTokenBreakdown({ totalTokens: 10, approximate: true })).toBeNull();
  });
});
