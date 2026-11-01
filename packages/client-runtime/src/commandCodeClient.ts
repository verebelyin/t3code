import { CommandCodeSettings, ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

// Fork-only provider; kept out of providerClients.ts so upstream edits merge cleanly.
export const commandCodeClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("commandcode"),
  label: "Command Code",
  badgeLabel: "Early Access",
  settingsSchema: CommandCodeSettings,
  hasDefaultInstance: false,
});
