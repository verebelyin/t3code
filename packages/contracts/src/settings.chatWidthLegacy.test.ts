import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ClientSettingsSchema } from "./settings.ts";

describe("ClientSettings legacy fork chat width", () => {
  it('reads the old fork "default" width as comfortable', () => {
    expect(Schema.decodeSync(ClientSettingsSchema)({ chatWidth: "default" }).chatWidth).toBe(
      "comfortable",
    );
  });
});
