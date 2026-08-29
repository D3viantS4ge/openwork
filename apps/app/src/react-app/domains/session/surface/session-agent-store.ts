// Per-conversation agent (mode) memory. Each session remembers the agent it
// last used — Plan, Build, etc. — so switching conversations restores that
// session's own agent instead of inheriting the previous session's choice.
// Sessions without a remembered agent fall back to the global default.
import { create } from "zustand";

const STORAGE_KEY = "openwork.sessionAgents.v1";
const MAX_REMEMBERED_SESSIONS = 200;

function readStoredAgents(): Record<string, string | null> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries: Record<string, string | null> = {};
    for (const [sessionId, value] of Object.entries(parsed)) {
      if (value === null || typeof value === "string") entries[sessionId] = value;
    }
    return entries;
  } catch {
    return {};
  }
}

function writeStoredAgents(bySessionId: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bySessionId));
  } catch {
    // Ignore storage failures.
  }
}

/** Keep the newest entries (object insertion order) under the cap. */
function capAgents(bySessionId: Record<string, string | null>) {
  const keys = Object.keys(bySessionId);
  if (keys.length <= MAX_REMEMBERED_SESSIONS) return bySessionId;
  const trimmed: Record<string, string | null> = {};
  for (const key of keys.slice(keys.length - MAX_REMEMBERED_SESSIONS)) {
    trimmed[key] = bySessionId[key];
  }
  return trimmed;
}

type SessionAgentStore = {
  bySessionId: Record<string, string | null>;
  /** Remember a session's agent (null = the default agent). No-op when unchanged. */
  setAgent: (sessionId: string, agent: string | null) => void;
};

export const useSessionAgentStore = create<SessionAgentStore>((set) => ({
  bySessionId: readStoredAgents(),
  setAgent: (sessionId, agent) => set((state) => {
    if (state.bySessionId[sessionId] === agent) return state;
    const { [sessionId]: _replaced, ...rest } = state.bySessionId;
    const bySessionId = capAgents({ ...rest, [sessionId]: agent });
    writeStoredAgents(bySessionId);
    return { bySessionId };
  }),
}));

/**
 * Remembered agent for a session. Returns `undefined` when the session has no
 * memory (so callers can fall back), otherwise the agent name or `null` for
 * the default agent.
 */
export function getSessionAgent(sessionId: string): string | null | undefined {
  return useSessionAgentStore.getState().bySessionId[sessionId];
}
