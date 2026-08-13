import { describe, expect, test } from "bun:test";

import {
  DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  isNotificationSoundId,
  isNotificationSoundPreferences,
  soundIdCategory,
  soundIdLabel,
} from "../src/react-app/kernel/notification-sound-preferences";

describe("notification sound preferences", () => {
  test("defaults to off with the opencode web default sound per event", () => {
    expect(DEFAULT_NOTIFICATION_SOUND_PREFERENCES.enabled).toBe(false);
    expect(DEFAULT_NOTIFICATION_SOUND_PREFERENCES.sounds["task.completed"]).toBe("staplebops-01");
    expect(DEFAULT_NOTIFICATION_SOUND_PREFERENCES.sounds["task.failed"]).toBe("nope-03");
    expect(DEFAULT_NOTIFICATION_SOUND_PREFERENCES.sounds["permission.asked"]).toBe("staplebops-02");
    expect(DEFAULT_NOTIFICATION_SOUND_PREFERENCES.sounds["question.asked"]).toBe("staplebops-02");
  });

  test("sanitizer accepts valid preferences, including empty sound maps", () => {
    expect(
      isNotificationSoundPreferences({
        enabled: true,
        sounds: { "task.completed": "yup-01" },
      }),
    ).toBe(true);
    expect(isNotificationSoundPreferences({ enabled: false, sounds: {} })).toBe(true);
  });

  test("sanitizer rejects unknown ids, unknown events, and malformed shapes", () => {
    expect(
      isNotificationSoundPreferences({
        enabled: true,
        sounds: { "task.completed": "mystery-01" },
      }),
    ).toBe(false);
    expect(
      isNotificationSoundPreferences({
        enabled: true,
        sounds: { "session.idle": "yup-01" },
      }),
    ).toBe(false);
    expect(isNotificationSoundPreferences({ enabled: "yes", sounds: {} })).toBe(false);
    expect(isNotificationSoundPreferences(null)).toBe(false);
    expect(isNotificationSoundPreferences("yup-01")).toBe(false);
  });

  test("sound ids map to categories and human labels", () => {
    expect(soundIdCategory("alert-01")).toBe("alerts");
    expect(soundIdCategory("bip-bop-05")).toBe("bip-bops");
    expect(soundIdCategory("staplebops-03")).toBe("staplebops");
    expect(soundIdCategory("nope-12")).toBe("nopes");
    expect(soundIdCategory("yup-06")).toBe("yups");

    expect(isNotificationSoundId("nope-12")).toBe(true);
    expect(isNotificationSoundId("nope-13")).toBe(false);
    expect(isNotificationSoundId(42)).toBe(false);

    expect(soundIdLabel("alert-01")).toBe("Alert 01");
    expect(soundIdLabel("bip-bop-03")).toBe("Bip-bop 03");
  });
});
