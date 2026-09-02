import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ClientSettingsSchema } from "./settings.ts";

const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);

// Fork-only client settings. Kept apart from settings.test.ts so upstream
// edits there merge cleanly.

describe("ClientSettings detailed tool call rows", () => {
  it("defaults detailed tool call rows on", () => {
    expect(decodeClientSettings({}).richToolCallRows).toBe(true);
  });

  it("round-trips an explicit opt-out", () => {
    expect(decodeClientSettings({ richToolCallRows: false }).richToolCallRows).toBe(false);
  });
});

describe("ClientSettings expanded tool calls", () => {
  it("defaults expanded tool calls on", () => {
    expect(decodeClientSettings({}).expandedToolCalls).toBe(true);
  });

  it("round-trips an explicit opt-out", () => {
    expect(decodeClientSettings({ expandedToolCalls: false }).expandedToolCalls).toBe(false);
  });
});
