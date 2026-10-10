import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import { deriveProviderInstanceConfigMap } from "../ProviderInstanceRegistryHydration.ts";
import { mergeProviderSnapshot } from "../ProviderRegistry.ts";
import { buildServerProvider } from "@t3tools/provider-core/server/snapshotProbe";

const driver = ProviderDriverKind.make("commandcode");
const instanceId = ProviderInstanceId.make("commandcode-work");

function snapshot(models: ServerProvider["models"]): ServerProvider {
  return {
    ...buildServerProvider({
      presentation: { displayName: "Command Code" },
      enabled: true,
      checkedAt: "2026-10-03T00:00:00.000Z",
      models,
      probe: {
        installed: true,
        version: "1.74.0",
        status: "ready",
        auth: { status: "authenticated" },
      },
    }),
    instanceId,
    driver,
  };
}

describe("Command Code registration", () => {
  it("hydrates explicit instances without fabricating a legacy default", () => {
    const config = {
      driver,
      enabled: true,
      config: { binaryPath: "/opt/command-code" },
    };
    const instances = deriveProviderInstanceConfigMap({
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: { [instanceId]: config },
    });
    expect(instances[instanceId]).toEqual(config);
    expect(instances[ProviderInstanceId.make("commandcode")]).toBeUndefined();
  });

  it("replaces a discovered catalog so retired native models disappear", () => {
    const previous = snapshot([
      { slug: "retired-model", name: "Retired", isCustom: false, capabilities: null },
    ]);
    const next = snapshot([
      { slug: "current-model", name: "Current", isCustom: false, capabilities: null },
    ]);
    expect(mergeProviderSnapshot(previous, next).models.map((model) => model.slug)).toEqual([
      "current-model",
    ]);
  });

  it("drops cached native models when an account signs out or is disabled", () => {
    const previous = snapshot([
      { slug: "private-model", name: "Private", isCustom: false, capabilities: null },
    ]);
    expect(
      mergeProviderSnapshot(previous, {
        ...snapshot([]),
        auth: { status: "unauthenticated" },
      }).models,
    ).toEqual([]);
    expect(
      mergeProviderSnapshot(previous, { ...snapshot([]), enabled: false, status: "disabled" })
        .models,
    ).toEqual([]);
  });
});
