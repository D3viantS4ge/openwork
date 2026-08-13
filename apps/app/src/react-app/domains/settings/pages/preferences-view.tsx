/** @jsxImportSource react */
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { t } from "@/i18n";
import {
  DESKTOP_NOTIFICATION_PREFERENCE_VALUES,
  isDesktopNotificationPreference,
  type DesktopNotificationPreference,
} from "@/react-app/kernel/desktop-notification-preferences";
import {
  NOTIFICATION_SOUND_CATEGORIES,
  NOTIFICATION_SOUND_EVENTS,
  NOTIFICATION_SOUND_IDS,
  isNotificationSoundId,
  soundIdCategory,
  soundIdLabel,
  type NotificationSoundCategory,
  type NotificationSoundEvent,
  type NotificationSoundPreferences,
} from "@/react-app/kernel/notification-sound-preferences";
import { playSoundById } from "@/react-app/shell/notification-sounds";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemDescription,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";
import { DesktopIntegrationSection } from "../desktop-integration-section";

export type PreferencesViewProps = {
  busy: boolean;
  showThinking: boolean;
  onToggleShowThinking: () => void;
  autoCompactContext: boolean;
  autoCompactContextBusy: boolean;
  onToggleAutoCompactContext: () => void;
  analyticsEnabled: boolean;
  onToggleAnalytics: () => void;
  desktopNotifications: DesktopNotificationPreference;
  onDesktopNotificationsChange: (value: DesktopNotificationPreference) => void;
  notificationSounds: NotificationSoundPreferences;
  onNotificationSoundsChange: (value: NotificationSoundPreferences) => void;
  memoryEnabled: boolean;
  onToggleMemory: () => void;
  showAutomations: boolean;
  automationsEnabled: boolean;
  onToggleAutomations: () => void;
};

function desktopNotificationPreferenceLabel(value: DesktopNotificationPreference) {
  switch (value) {
    case "important":
      return t("settings.desktop_notifications.important");
    case "all":
      return t("settings.desktop_notifications.all");
    case "off":
      return t("settings.desktop_notifications.off");
  }
}

const SOUND_NONE_VALUE = "none";

const NOTIFICATION_SOUND_ROW_EVENTS: {
  event: NotificationSoundEvent;
  titleKey: string;
  descriptionKey: string;
}[] = [
  {
    event: "task.completed",
    titleKey: "settings.notification_sounds.event.task_completed",
    descriptionKey: "settings.notification_sounds.event.task_completed_desc",
  },
  {
    event: "permission.asked",
    titleKey: "settings.notification_sounds.event.permission_asked",
    descriptionKey: "settings.notification_sounds.event.permission_asked_desc",
  },
  {
    event: "question.asked",
    titleKey: "settings.notification_sounds.event.question_asked",
    descriptionKey: "settings.notification_sounds.event.question_asked_desc",
  },
  {
    event: "task.failed",
    titleKey: "settings.notification_sounds.event.task_failed",
    descriptionKey: "settings.notification_sounds.event.task_failed_desc",
  },
];

function notificationSoundCategoryLabel(category: NotificationSoundCategory): string {
  switch (category) {
    case "alerts":
      return t("settings.notification_sounds.category.alerts");
    case "bip-bops":
      return t("settings.notification_sounds.category.bip_bops");
    case "staplebops":
      return t("settings.notification_sounds.category.staplebops");
    case "nopes":
      return t("settings.notification_sounds.category.nopes");
    case "yups":
      return t("settings.notification_sounds.category.yups");
  }
}

type NotificationSoundEventRowProps = {
  event: NotificationSoundEvent;
  title: string;
  description: string;
  sounds: NotificationSoundPreferences["sounds"];
  disabled: boolean;
  onChange: (sounds: NotificationSoundPreferences["sounds"]) => void;
};

function NotificationSoundEventRow({
  event,
  title,
  description,
  sounds,
  disabled,
  onChange,
}: NotificationSoundEventRowProps) {
  const selected = sounds[event];
  return (
    <LayoutSectionItem>
      <LayoutSectionItemHeader>
        <LayoutSectionItemTitle>{title}</LayoutSectionItemTitle>
        <LayoutSectionItemDescription>{description}</LayoutSectionItemDescription>
        <LayoutSectionItemHeaderActions>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("settings.notification_sounds.preview")}
              disabled={disabled || !selected}
              onClick={() => {
                if (selected) void playSoundById(selected);
              }}
            >
              <Play className="size-4" />
            </Button>
            <div className="w-44 max-w-full">
              <Select
                value={selected ?? SOUND_NONE_VALUE}
                onValueChange={(value) => {
                  if (value === SOUND_NONE_VALUE) {
                    const next = { ...sounds };
                    delete next[event];
                    onChange(next);
                    return;
                  }
                  if (isNotificationSoundId(value)) {
                    onChange({ ...sounds, [event]: value });
                  }
                }}
                disabled={disabled}
              >
                <SelectTrigger className="w-full" aria-label={title}>
                  <SelectValue placeholder={t("settings.notification_sounds.none")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SOUND_NONE_VALUE}>
                    {t("settings.notification_sounds.none")}
                  </SelectItem>
                  {NOTIFICATION_SOUND_CATEGORIES.map((category) => (
                    <SelectGroup key={category}>
                      <SelectLabel>{notificationSoundCategoryLabel(category)}</SelectLabel>
                      {NOTIFICATION_SOUND_IDS.filter((id) => soundIdCategory(id) === category).map(
                        (id) => (
                          <SelectItem key={id} value={id}>
                            {soundIdLabel(id)}
                          </SelectItem>
                        ),
                      )}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </LayoutSectionItemHeaderActions>
      </LayoutSectionItemHeader>
    </LayoutSectionItem>
  );
}

export function PreferencesView(props: PreferencesViewProps) {
  const desktopNotificationItems = DESKTOP_NOTIFICATION_PREFERENCE_VALUES.map((value) => ({
    value,
    label: desktopNotificationPreferenceLabel(value),
  }));

  return (
    <LayoutStack>
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.model_title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.model_section_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        {/* Show reasoning */}
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.show_model_reasoning")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.show_model_reasoning_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.show_model_reasoning")}
                checked={props.showThinking}
                disabled={props.busy}
                onCheckedChange={props.onToggleShowThinking}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        {/* Auto context compaction */}
        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.auto_compact")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.auto_compact_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.auto_compact")}
                checked={props.autoCompactContext}
                disabled={props.busy || props.autoCompactContextBusy}
                onCheckedChange={props.onToggleAutoCompactContext}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>

      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.desktop_notifications.title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.desktop_notifications.section_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.desktop_notifications.mode")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.desktop_notifications.mode_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <div className="w-44 max-w-full">
                <Select
                  value={props.desktopNotifications}
                  items={desktopNotificationItems}
                  onValueChange={(value) => {
                    if (isDesktopNotificationPreference(value)) {
                      props.onDesktopNotificationsChange(value);
                    }
                  }}
                  disabled={props.busy}
                >
                  <SelectTrigger className="w-full" aria-label={t("settings.desktop_notifications.mode")}>
                    <SelectValue placeholder={t("settings.desktop_notifications.off")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {DESKTOP_NOTIFICATION_PREFERENCE_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {desktopNotificationPreferenceLabel(value)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>

      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.notification_sounds.title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.notification_sounds.section_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.notification_sounds.master")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.notification_sounds.master_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.notification_sounds.master")}
                checked={props.notificationSounds.enabled}
                disabled={props.busy}
                onCheckedChange={(enabled) =>
                  props.onNotificationSoundsChange({ ...props.notificationSounds, enabled })
                }
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        {NOTIFICATION_SOUND_ROW_EVENTS.map((row) => (
          <NotificationSoundEventRow
            key={row.event}
            event={row.event}
            title={t(row.titleKey)}
            description={t(row.descriptionKey)}
            sounds={props.notificationSounds.sounds}
            disabled={props.busy || !props.notificationSounds.enabled}
            onChange={(sounds) =>
              props.onNotificationSoundsChange({ ...props.notificationSounds, sounds })
            }
          />
        ))}
      </LayoutSection>

      <DesktopIntegrationSection />

      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.privacy_title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.privacy_section_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("settings.analytics_toggle")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("settings.analytics_toggle_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("settings.analytics_toggle")}
                checked={props.analyticsEnabled}
                disabled={props.busy}
                onCheckedChange={props.onToggleAnalytics}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>

      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("memory.preferences_title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("memory.preferences_section_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>{t("memory.preferences_toggle")}</LayoutSectionItemTitle>
            <LayoutSectionItemDescription>{t("memory.preferences_toggle_desc")}</LayoutSectionItemDescription>
            <LayoutSectionItemHeaderActions>
              <Switch
                aria-label={t("memory.preferences_toggle")}
                checked={props.memoryEnabled}
                disabled={props.busy}
                onCheckedChange={props.onToggleMemory}
              />
            </LayoutSectionItemHeaderActions>
          </LayoutSectionItemHeader>
        </LayoutSectionItem>
      </LayoutSection>

      {props.showAutomations ? (
        <LayoutSection>
          <LayoutSectionHeader>
            <LayoutSectionTitle>{t("automations.preferences_title")}</LayoutSectionTitle>
            <LayoutSectionDescription>{t("automations.preferences_section_desc")}</LayoutSectionDescription>
          </LayoutSectionHeader>

          <LayoutSectionItem>
            <LayoutSectionItemHeader>
              <LayoutSectionItemTitle>{t("automations.preferences_toggle")}</LayoutSectionItemTitle>
              <LayoutSectionItemDescription>{t("automations.preferences_toggle_desc")}</LayoutSectionItemDescription>
              <LayoutSectionItemHeaderActions>
                <Switch
                  aria-label={t("automations.preferences_toggle")}
                  checked={props.automationsEnabled}
                  disabled={props.busy}
                  onCheckedChange={props.onToggleAutomations}
                />
              </LayoutSectionItemHeaderActions>
            </LayoutSectionItemHeader>
          </LayoutSectionItem>
        </LayoutSection>
      ) : null}
    </LayoutStack>
  );
}
