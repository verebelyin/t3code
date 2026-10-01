import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Fork-only appearance rows (detailed and expanded tool calls).
 * Mounted at the tail of the upstream appearance section so changes to
 * SettingsPanels.tsx merge cleanly.
 */
export function ForkAppearanceSettingsRows() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <>
      <SettingsRow
        {...searchableSetting("tool-call-rows")}
        description="Name tool calls in the timeline, like Read(src/app.ts), and show an inline diff when a file changes. Off shows one generic row per tool call."
        resetAction={
          settings.richToolCallRows !== DEFAULT_UNIFIED_SETTINGS.richToolCallRows ? (
            <SettingResetButton
              label="detailed tool calls"
              onClick={() =>
                updateSettings({ richToolCallRows: DEFAULT_UNIFIED_SETTINGS.richToolCallRows })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.richToolCallRows}
            onCheckedChange={(checked) => updateSettings({ richToolCallRows: Boolean(checked) })}
            aria-label="Show detailed tool calls with file names and inline diffs"
          />
        }
      />

      <SettingsRow
        {...searchableSetting("expanded-tool-calls")}
        description="List every tool call in the timeline. File changes stay open so scrolling back shows what changed; commands and other calls open on click. Off keeps only the latest call visible behind a toggle."
        resetAction={
          settings.expandedToolCalls !== DEFAULT_UNIFIED_SETTINGS.expandedToolCalls ? (
            <SettingResetButton
              label="expanded tool calls"
              onClick={() =>
                updateSettings({ expandedToolCalls: DEFAULT_UNIFIED_SETTINGS.expandedToolCalls })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.expandedToolCalls}
            onCheckedChange={(checked) => updateSettings({ expandedToolCalls: Boolean(checked) })}
            aria-label="Show every tool call and keep file changes open"
          />
        }
      />
    </>
  );
}
