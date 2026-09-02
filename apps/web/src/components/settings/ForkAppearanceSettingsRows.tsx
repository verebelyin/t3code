import {
  type ChatWidth,
  DEFAULT_CHAT_WIDTH,
  DEFAULT_UNIFIED_SETTINGS,
} from "@t3tools/contracts/settings";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
  default: "Default",
  wide: "Wide",
  full: "Full width",
};

function isChatWidth(value: string): value is ChatWidth {
  return value in CHAT_WIDTH_LABELS;
}

/**
 * Fork-only appearance rows (chat width, detailed and expanded tool calls).
 * Mounted at the tail of the upstream appearance section so changes to
 * SettingsPanels.tsx merge cleanly.
 */
export function ForkAppearanceSettingsRows() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <>
      <SettingsRow
        {...searchableSetting("chat-width")}
        description="Max width of the centered chat column. Wide and full width fit more code and diff content on large screens."
        resetAction={
          settings.chatWidth !== DEFAULT_CHAT_WIDTH ? (
            <SettingResetButton
              label="chat width"
              onClick={() => updateSettings({ chatWidth: DEFAULT_CHAT_WIDTH })}
            />
          ) : null
        }
        control={
          <Select
            value={settings.chatWidth}
            onValueChange={(value) => {
              if (typeof value === "string" && isChatWidth(value)) {
                updateSettings({ chatWidth: value });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-40" aria-label="Chat width">
              <SelectValue>{CHAT_WIDTH_LABELS[settings.chatWidth]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(CHAT_WIDTH_LABELS).map(([value, label]) => (
                <SelectItem hideIndicator key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />

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
