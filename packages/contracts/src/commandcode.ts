import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { TrimmedString } from "./baseSchemas.ts";

/** The built-in driver slug used by the Command Code ACP adapter. */
export const COMMAND_CODE_DRIVER_KIND = "commandcode" as const;

const binaryPath = TrimmedString.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transformEffect({
      decode: (value) => Effect.succeed(value || "command-code"),
      encode: (value) => Effect.succeed(value),
    }),
  ),
  Schema.withDecodingDefault(Effect.succeed("command-code")),
  Schema.annotateKey({
    title: "Binary path",
    description: "Path to the Command Code binary used by this instance.",
    providerSettingsForm: { placeholder: "command-code", clearWhenEmpty: "omit" },
  }),
);

export const CommandCodeSettings = Schema.Struct({ binaryPath });
export type CommandCodeSettings = typeof CommandCodeSettings.Type;
