/**
 * Sound-only notification preferences. Mirrors the opencode web client's
 * sound system: a library of alert chimes (vendored from the pinned
 * opencode submodule at vendor/opencode) selectable per session event,
 * played in addition to (or instead of) native OS notifications.
 */

export const NOTIFICATION_SOUND_EVENTS = [
  "task.completed",
  "task.failed",
  "permission.asked",
  "question.asked",
] as const;

export type NotificationSoundEvent = (typeof NOTIFICATION_SOUND_EVENTS)[number];

export const NOTIFICATION_SOUND_CATEGORIES = [
  "alerts",
  "bip-bops",
  "staplebops",
  "nopes",
  "yups",
] as const;

export type NotificationSoundCategory = (typeof NOTIFICATION_SOUND_CATEGORIES)[number];

/**
 * The sound library shipped by opencode web (see
 * vendor/opencode/packages/ui/src/assets/audio/). Ids double as the asset
 * file names, so they must stay in sync with the globbed files.
 */
export const NOTIFICATION_SOUND_IDS = [
  "alert-01",
  "alert-02",
  "alert-03",
  "alert-04",
  "alert-05",
  "alert-06",
  "alert-07",
  "alert-08",
  "alert-09",
  "alert-10",
  "bip-bop-01",
  "bip-bop-02",
  "bip-bop-03",
  "bip-bop-04",
  "bip-bop-05",
  "bip-bop-06",
  "bip-bop-07",
  "bip-bop-08",
  "bip-bop-09",
  "bip-bop-10",
  "staplebops-01",
  "staplebops-02",
  "staplebops-03",
  "staplebops-04",
  "staplebops-05",
  "staplebops-06",
  "staplebops-07",
  "nope-01",
  "nope-02",
  "nope-03",
  "nope-04",
  "nope-05",
  "nope-06",
  "nope-07",
  "nope-08",
  "nope-09",
  "nope-10",
  "nope-11",
  "nope-12",
  "yup-01",
  "yup-02",
  "yup-03",
  "yup-04",
  "yup-05",
  "yup-06",
] as const;

export type NotificationSoundId = (typeof NOTIFICATION_SOUND_IDS)[number];

export function isNotificationSoundId(value: unknown): value is NotificationSoundId {
  return typeof value === "string" && (NOTIFICATION_SOUND_IDS as readonly string[]).includes(value);
}

export function soundIdCategory(id: NotificationSoundId): NotificationSoundCategory {
  if (id.startsWith("alert-")) return "alerts";
  if (id.startsWith("bip-bop-")) return "bip-bops";
  if (id.startsWith("staplebops-")) return "staplebops";
  if (id.startsWith("nope-")) return "nopes";
  return "yups";
}

/** Human label for a sound id, e.g. "alert-01" -> "Alert 01". */
export function soundIdLabel(id: NotificationSoundId): string {
  const hyphen = id.lastIndexOf("-");
  if (hyphen <= 0) return id;
  const name = id.slice(0, hyphen);
  const number = id.slice(hyphen + 1);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${number}`;
}

export type NotificationSoundPreferences = {
  enabled: boolean;
  sounds: Partial<Record<NotificationSoundEvent, NotificationSoundId>>;
};

/**
 * Off by default so upgrading users are not surprised by chimes. When
 * enabled, each event falls back to the opencode web client's default
 * sound for that event (staplebops-01 for turn complete, staplebops-02
 * for permissions/questions, nope-03 for errors) unless the user picked
 * one (or explicitly chose none).
 */
export const DEFAULT_NOTIFICATION_SOUND_PREFERENCES: NotificationSoundPreferences = {
  enabled: false,
  sounds: {
    "task.completed": "staplebops-01",
    "task.failed": "nope-03",
    "permission.asked": "staplebops-02",
    "question.asked": "staplebops-02",
  },
};

export function isNotificationSoundPreferences(value: unknown): value is NotificationSoundPreferences {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.enabled !== "boolean") return false;
  const sounds = candidate.sounds;
  if (typeof sounds !== "object" || sounds === null) return false;
  return Object.entries(sounds as Record<string, unknown>).every(
    ([event, id]) =>
      (NOTIFICATION_SOUND_EVENTS as readonly string[]).includes(event) &&
      isNotificationSoundId(id),
  );
}
