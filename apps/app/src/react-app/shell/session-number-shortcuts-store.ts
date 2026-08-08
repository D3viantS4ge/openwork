// UI state for the session-number shortcuts (Ctrl/Cmd+1-9 jump). Lives in a
// dedicated store so a bare modifier keydown only re-renders the sidebar
// (its single consumer), never the whole session route/surface. Previously
// this state was local to useShellShortcuts, so every Ctrl press and release
// re-rendered SessionRoute -> SessionPage -> SessionSurface; when that
// cascade landed on re-rendering chat markdown, the rendered HTML was
// re-set and any text selection inside it collapsed.
import { create } from "zustand";

import type {
  SessionNumberShortcutOs,
  SessionNumberShortcutTarget,
} from "./session-number-shortcuts";

type SessionNumberShortcutsStore = {
  modifierHeld: boolean;
  os: SessionNumberShortcutOs;
  targets: readonly SessionNumberShortcutTarget[];
  setModifierHeld: (modifierHeld: boolean) => void;
  setOs: (os: SessionNumberShortcutOs) => void;
  setTargets: (targets: readonly SessionNumberShortcutTarget[]) => void;
};

export const useSessionNumberShortcutsStore = create<SessionNumberShortcutsStore>((set) => ({
  modifierHeld: false,
  os: "windows",
  targets: [],
  setModifierHeld: (modifierHeld) => set({ modifierHeld }),
  setOs: (os) => set({ os }),
  setTargets: (targets) => set({ targets }),
}));
