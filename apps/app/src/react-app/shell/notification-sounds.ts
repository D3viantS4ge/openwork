/**
 * Sound-only notification playback. Mirrors the opencode web client's sound
 * system: .aac chimes are globbed from the pinned opencode submodule
 * (vendor/opencode/packages/ui/src/assets/audio/) so Vite emits them as
 * assets, then played via a plain Audio element. Plays regardless of app
 * focus and independently of the native desktop-notification preference.
 */
import { LOCAL_PREFERENCES_KEY } from "@/react-app/kernel/local-preferences-storage";
import {
  DEFAULT_NOTIFICATION_SOUND_PREFERENCES,
  isNotificationSoundPreferences,
  type NotificationSoundId,
  type NotificationSoundPreferences,
} from "@/react-app/kernel/notification-sound-preferences";
import type { DesktopNotificationEvent } from "./desktop-notifications";

type SoundLoader = () => Promise<string | undefined>;

let soundSourceOverride: ((id: NotificationSoundId) => Promise<string | undefined>) | null = null;

/**
 * Test seam: replaces the import.meta.glob asset resolution (which cannot
 * resolve .aac files under bun). Mirrors setWebNotificationHandler.
 */
export function setSoundSourceOverride(
  override: ((id: NotificationSoundId) => Promise<string | undefined>) | null,
): void {
  soundSourceOverride = override;
}

function getLoaders(): Record<string, SoundLoader> {
  try {
    // Same mechanism as the opencode web client's utils/sound.ts: glob the
    // library lazily and let Vite emit each matched file as an asset.
    const files = import.meta.glob(
      "../../../../../vendor/opencode/packages/ui/src/assets/audio/*.aac",
      { import: "default" },
    ) as Record<string, () => Promise<unknown>>;
    const loaders: Record<string, SoundLoader> = {};
    for (const [path, load] of Object.entries(files)) {
      const file = path.split("/").at(-1);
      if (!file) continue;
      const id = file.replace(/\.aac$/, "");
      loaders[id] = async () => {
        const value = await load();
        return typeof value === "string" ? value : undefined;
      };
    }
    return loaders;
  } catch {
    return {};
  }
}

let loadersCache: Record<string, SoundLoader> | undefined;

function loaders(): Record<string, SoundLoader> {
  if (!loadersCache) loadersCache = getLoaders();
  return loadersCache;
}

const srcCache = new Map<NotificationSoundId, Promise<string | undefined>>();

/** Resolves the asset URL for a sound id, cached after the first request. */
export function soundSrc(id: NotificationSoundId | undefined): Promise<string | undefined> {
  if (!id) return Promise.resolve(undefined);
  if (soundSourceOverride) return soundSourceOverride(id);
  const hit = srcCache.get(id);
  if (hit) return hit;
  const loader = loaders()[id];
  const next = loader ? Promise.resolve(loader()).catch(() => undefined) : Promise.resolve(undefined);
  srcCache.set(id, next);
  return next;
}

/** Plays a resolved asset URL; returns a cleanup that stops playback. */
export function playSound(src: string | undefined): (() => void) | undefined {
  if (typeof Audio === "undefined") return undefined;
  if (!src) return undefined;
  const audio = new Audio(src);
  void audio.play().catch(() => undefined);
  return () => {
    audio.pause();
    audio.currentTime = 0;
  };
}

export function playSoundById(id: NotificationSoundId | undefined): Promise<(() => void) | undefined> {
  return soundSrc(id).then((src) => playSound(src));
}

function readNotificationSoundPreferences(): NotificationSoundPreferences {
  if (typeof window === "undefined") return DEFAULT_NOTIFICATION_SOUND_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFERENCES_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_SOUND_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    const value =
      parsed && typeof parsed === "object"
        ? Reflect.get(parsed, "notificationSounds")
        : undefined;
    return isNotificationSoundPreferences(value)
      ? value
      : DEFAULT_NOTIFICATION_SOUND_PREFERENCES;
  } catch {
    return DEFAULT_NOTIFICATION_SOUND_PREFERENCES;
  }
}

/**
 * Plays the configured sound for a session event, if notification sounds are
 * enabled and the event has a sound assigned (None disables it).
 */
export function playEventSound(event: DesktopNotificationEvent): void {
  const prefs = readNotificationSoundPreferences();
  if (!prefs.enabled) return;
  const id = prefs.sounds[event.type];
  if (!id) return;
  void playSoundById(id);
}
