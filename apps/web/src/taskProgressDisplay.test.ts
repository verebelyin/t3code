import { describe, expect, it } from "vite-plus/test";

import {
  formatTaskDuration,
  formatTaskProgressMeta,
  formatTaskTokens,
} from "./taskProgressDisplay";

describe("formatTaskDuration", () => {
  it("keeps one decimal under ten seconds", () => {
    expect(formatTaskDuration(400)).toBe("0.4s");
    expect(formatTaskDuration(9_440)).toBe("9.4s");
  });

  it("rounds to whole seconds under a minute", () => {
    expect(formatTaskDuration(43_600)).toBe("44s");
  });

  it("splits minutes and seconds", () => {
    expect(formatTaskDuration(139_792)).toBe("2m 20s");
    expect(formatTaskDuration(120_000)).toBe("2m");
  });

  it("carries instead of rendering sixty seconds", () => {
    expect(formatTaskDuration(119_600)).toBe("2m");
  });
});

describe("formatTaskTokens", () => {
  it("scales to k and M", () => {
    expect(formatTaskTokens(842)).toBe("842");
    expect(formatTaskTokens(9_440)).toBe("9.4k");
    expect(formatTaskTokens(80_339)).toBe("80k");
    expect(formatTaskTokens(2_400_000)).toBe("2.4M");
  });
});

describe("formatTaskProgressMeta", () => {
  it("orders tool, count, duration, then cost", () => {
    expect(
      formatTaskProgressMeta({
        lastToolName: "Bash",
        toolUses: 12,
        durationMs: 139_792,
        totalTokens: 80_339,
      }),
    ).toEqual(["Bash", "12 tools", "2m 20s", "80k tokens"]);
  });

  it("singularises a lone tool use", () => {
    expect(formatTaskProgressMeta({ toolUses: 1 })).toEqual(["1 tool"]);
  });

  it("renders only what is present", () => {
    expect(formatTaskProgressMeta({ lastToolName: "Grep" })).toEqual(["Grep"]);
  });

  it("returns null when there is nothing to say", () => {
    expect(formatTaskProgressMeta(undefined)).toBeNull();
    expect(formatTaskProgressMeta({})).toBeNull();
  });
});
