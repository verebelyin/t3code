import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { CommandCodeSettings, COMMAND_CODE_DRIVER_KIND } from "./commandcode.ts";

const decodeCommandCodeSettings = Schema.decodeSync(CommandCodeSettings);

describe("Command Code contracts", () => {
  it("uses the lowercase driver slug and CLI default", () => {
    const settings = decodeCommandCodeSettings({});
    expect(COMMAND_CODE_DRIVER_KIND).toBe("commandcode");
    expect(settings.binaryPath).toBe("command-code");
  });

  it("preserves an explicit binary path", () => {
    const settings = decodeCommandCodeSettings({ binaryPath: " /opt/cmd " });
    expect(settings.binaryPath).toBe("/opt/cmd");
  });
});
