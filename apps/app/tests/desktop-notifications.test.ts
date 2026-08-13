import { beforeEach, describe, expect, test } from "bun:test";

import { LOCAL_PREFERENCES_KEY } from "../src/react-app/kernel/local-preferences-storage";
import type { NotificationSoundPreferences } from "../src/react-app/kernel/notification-sound-preferences";
import { notifyDesktopEvent } from "../src/react-app/shell/desktop-notifications";
import { setSoundSourceOverride } from "../src/react-app/shell/notification-sounds";

type DesktopCall = { command: string; args: unknown[] };

const storage = new Map<string, string>();
const calls: DesktopCall[] = [];

const localStorageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size;
  },
};

class AudioMock {
  src: string;
  currentTime = 0;
  constructor(src?: string) {
    this.src = src ?? "";
    audioInstances.push(this);
  }
  play() {
    return Promise.resolve();
  }
  pause() {
    // no-op
  }
}

const audioInstances: AudioMock[] = [];

function setPreference(value: "off" | "important" | "all") {
  localStorageStub.setItem(LOCAL_PREFERENCES_KEY, JSON.stringify({ desktopNotifications: value }));
}

function setSoundPreferences(
  enabled: boolean,
  sounds?: NotificationSoundPreferences["sounds"],
  desktopNotifications: "off" | "important" | "all" = "off",
) {
  localStorageStub.setItem(
    LOCAL_PREFERENCES_KEY,
    JSON.stringify({ desktopNotifications, notificationSounds: { enabled, sounds } }),
  );
}

function installRuntime({ focused }: { focused: boolean }) {
  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: localStorageStub,
      __OPENWORK_ELECTRON__: {
        invokeDesktop: async (command: string, ...args: unknown[]) => {
          calls.push({ command, args });
          return { ok: true };
        },
      },
    },
    configurable: true,
  });

  Object.defineProperty(globalThis, "document", {
    value: {
      visibilityState: focused ? "visible" : "hidden",
      hasFocus: () => focused,
    },
    configurable: true,
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("desktop notifications", () => {
  beforeEach(() => {
    storage.clear();
    calls.length = 0;
    audioInstances.length = 0;
    installRuntime({ focused: false });
    // The import.meta.glob asset resolution cannot load .aac files under
    // bun, so tests resolve sound sources through the deterministic seam.
    setSoundSourceOverride(async (id) => `https://audio.example/${id}.aac`);
    Object.defineProperty(globalThis, "Audio", {
      value: AudioMock,
      configurable: true,
    });
  });

  test("off suppresses important events", () => {
    setPreference("off");

    notifyDesktopEvent({ type: "task.failed", sessionId: "session-a", errorText: "Boom" });

    expect(calls).toHaveLength(0);
  });

  test("important sends attention events but not completions", async () => {
    setPreference("important");

    notifyDesktopEvent({ type: "task.completed", sessionId: "session-a" });
    notifyDesktopEvent({ type: "question.asked", sessionId: "session-a", question: "Question: Continue?" });
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "desktopNotificationShow",
      args: [{ title: "Question needs your answer", body: "Question: Continue?" }],
    });
  });

  test("all sends task completion notifications", async () => {
    setPreference("all");

    notifyDesktopEvent({ type: "task.completed", sessionId: "session-a" });
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "desktopNotificationShow",
      args: [{ title: "Task completed", body: "The session finished running." }],
    });
  });

  test("focused app suppresses native popups", () => {
    setPreference("all");
    installRuntime({ focused: true });

    notifyDesktopEvent({ type: "task.failed", sessionId: "session-a", errorText: "Boom" });

    expect(calls).toHaveLength(0);
  });

  test("sounds are silent when the preference is absent", async () => {
    setPreference("all");

    notifyDesktopEvent({ type: "task.completed", sessionId: "session-a" });
    await flush();

    expect(audioInstances).toHaveLength(0);
  });

  test("sounds stay silent while the master toggle is off", async () => {
    setSoundPreferences(false, { "task.completed": "yup-01" });

    notifyDesktopEvent({ type: "task.completed", sessionId: "session-a" });
    await flush();

    expect(audioInstances).toHaveLength(0);
  });

  test("enabled sounds play the configured sound for every event type", async () => {
    setSoundPreferences(true, {
      "task.completed": "yup-01",
      "task.failed": "nope-01",
      "permission.asked": "alert-02",
      "question.asked": "alert-03",
    });

    notifyDesktopEvent({ type: "task.completed", sessionId: "session-a" });
    notifyDesktopEvent({ type: "task.failed", sessionId: "session-a", errorText: "Boom" });
    notifyDesktopEvent({ type: "permission.asked", sessionId: "session-a", detail: "run: test" });
    notifyDesktopEvent({ type: "question.asked", sessionId: "session-a", question: "Continue?" });
    await flush();

    expect(audioInstances.map((audio) => audio.src)).toEqual([
      "https://audio.example/yup-01.aac",
      "https://audio.example/nope-01.aac",
      "https://audio.example/alert-02.aac",
      "https://audio.example/alert-03.aac",
    ]);
  });

  test("an event with no sound assigned stays silent", async () => {
    setSoundPreferences(true, { "task.completed": "yup-01" });

    notifyDesktopEvent({ type: "permission.asked", sessionId: "session-a", detail: "run: test" });
    notifyDesktopEvent({ type: "task.completed", sessionId: "session-a" });
    await flush();

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0]?.src).toBe("https://audio.example/yup-01.aac");
  });

  test("sounds play while the app is focused, without native popups", async () => {
    setSoundPreferences(true, { "task.completed": "yup-01" }, "all");
    installRuntime({ focused: true });

    notifyDesktopEvent({ type: "task.completed", sessionId: "session-a" });
    await flush();

    expect(audioInstances).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  test("sounds play alongside native notifications when unfocused", async () => {
    setSoundPreferences(true, { "task.completed": "yup-01" }, "all");

    notifyDesktopEvent({ type: "task.completed", sessionId: "session-a" });
    await flush();

    expect(audioInstances).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: "desktopNotificationShow" });
  });
});
