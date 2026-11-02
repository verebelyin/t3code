import { CommandCodeSettings, ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

// Fork-only provider; kept out of providerClients.ts so upstream edits merge cleanly.
export const commandCodeClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("commandcode"),
  label: "Command Code",
  badgeLabel: "Early Access",
  settingsSchema: CommandCodeSettings,
  hasDefaultInstance: false,
  // Terminal prompt `>_`, outlined from a 2.5-wide round-capped stroke.
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#171717", dark: "#e5e5e5" },
    paths: [
      {
        d: "M5.884 5.116 11.884 11.116A1.25 1.25 0 0 1 11.884 12.884L5.884 18.884A1.25 1.25 0 0 1 4.116 17.116L9.232 12 4.116 6.884A1.25 1.25 0 0 1 5.884 5.116Z",
      },
      { d: "M13 16.75H19A1.25 1.25 0 0 1 19 19.25H13A1.25 1.25 0 0 1 13 16.75Z" },
    ],
  },
});
