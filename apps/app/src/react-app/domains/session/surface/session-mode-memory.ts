import { useCallback, useEffect } from "react";
import { create } from "zustand";

const STORAGE_KEY = "openwork.sessionAgents.v1";
const ADOPTED_STORAGE_KEY = "openwork.sessionAgents.adopted.v1";
const MAX_REMEMBERED_SESSIONS = 200;

type SessionAgentSelections = Record<string, string | null>;
type SessionAgentAdoptions = Record<string, true>;

function capSelections(selections: SessionAgentSelections): SessionAgentSelections {
  return Object.fromEntries(Object.entries(selections).slice(-MAX_REMEMBERED_SESSIONS));
}

function capAdoptions(
  adoptions: SessionAgentAdoptions,
  selections: SessionAgentSelections,
): SessionAgentAdoptions {
  const entries: [string, true][] = [];
  for (const sessionId of Object.keys(adoptions)) {
    if (!Object.hasOwn(selections, sessionId)) continue;
    entries.push([sessionId, true]);
  }
  return Object.fromEntries(entries.slice(-MAX_REMEMBERED_SESSIONS));
}

export function readSessionAgentSelections(): SessionAgentSelections {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const entries: [string, string | null][] = [];
    for (const [sessionId, value] of Object.entries(parsed)) {
      const agent: unknown = value;
      if (!sessionId.trim() || (agent !== null && (typeof agent !== "string" || !agent.trim()))) continue;
      entries.push([sessionId, agent]);
    }
    return Object.fromEntries(entries.slice(-MAX_REMEMBERED_SESSIONS));
  } catch {
    return {};
  }
}

export function readSessionAgentAdoptions(): SessionAgentAdoptions {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ADOPTED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const entries: [string, true][] = [];
    for (const value of parsed) {
      if (typeof value !== "string" || !value.trim()) continue;
      entries.push([value, true]);
    }
    return Object.fromEntries(entries.slice(-MAX_REMEMBERED_SESSIONS));
  } catch {
    return {};
  }
}

function persistSessionAgents(
  selections: SessionAgentSelections,
  adoptions: SessionAgentAdoptions,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
    window.localStorage.setItem(ADOPTED_STORAGE_KEY, JSON.stringify(Object.keys(adoptions)));
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
}

type SessionAgentStore = {
  bySessionId: SessionAgentSelections;
  adoptedBySessionId: SessionAgentAdoptions;
  /** Records a deliberate user choice and clears any auto-adoption marker. */
  setAgent: (sessionId: string, agent: string | null) => void;
  /** Records the fallback a memory-less session shows on open. */
  adoptAgent: (sessionId: string, agent: string | null) => void;
};

export const useSessionAgentStore = create<SessionAgentStore>((set) => {
  const bySessionId = readSessionAgentSelections();
  return {
    bySessionId,
    adoptedBySessionId: capAdoptions(readSessionAgentAdoptions(), bySessionId),
    setAgent: (sessionId, agent) => set((state) => {
      if (!sessionId.trim()) return state;
      const unchanged = Object.hasOwn(state.bySessionId, sessionId) && state.bySessionId[sessionId] === agent;
      const wasAdopted = Object.hasOwn(state.adoptedBySessionId, sessionId);
      if (unchanged && !wasAdopted) return state;
      const { [sessionId]: _replaced, ...rest } = state.bySessionId;
      const nextSelections = capSelections({ ...rest, [sessionId]: agent });
      const nextAdoptions = capAdoptions(state.adoptedBySessionId, nextSelections);
      delete nextAdoptions[sessionId];
      persistSessionAgents(nextSelections, nextAdoptions);
      return { bySessionId: nextSelections, adoptedBySessionId: nextAdoptions };
    }),
    adoptAgent: (sessionId, agent) => set((state) => {
      if (!sessionId.trim()) return state;
      if (Object.hasOwn(state.bySessionId, sessionId)) return state;
      const nextSelections = capSelections({ ...state.bySessionId, [sessionId]: agent });
      const nextAdoptions = capAdoptions(
        { ...state.adoptedBySessionId, [sessionId]: true },
        nextSelections,
      );
      persistSessionAgents(nextSelections, nextAdoptions);
      return { bySessionId: nextSelections, adoptedBySessionId: nextAdoptions };
    }),
  };
});

export function getSessionAgentSelection(sessionId: string, fallbackAgent: string | null = null): string | null {
  const selections = useSessionAgentStore.getState().bySessionId;
  return Object.hasOwn(selections, sessionId) ? selections[sessionId] : fallbackAgent;
}

/**
 * Remembered agent for a session. Returns `undefined` when the session has no
 * memory (so callers can fall back or seed), otherwise the agent name or
 * `null` for the default agent. Auto-adopted fallbacks are remembered too;
 * use `isSessionAgentAdopted` to tell them apart from deliberate choices.
 */
export function getSessionAgent(sessionId: string): string | null | undefined {
  return useSessionAgentStore.getState().bySessionId[sessionId];
}

/** True when the remembered value was only adopted from the fallback on open. */
export function isSessionAgentAdopted(sessionId: string): boolean {
  return Object.hasOwn(useSessionAgentStore.getState().adoptedBySessionId, sessionId);
}

export function useSessionAgentSelection(input: {
  sessionId: string | null;
  fallbackAgent: string | null;
  onFallbackAgentChange: (agent: string | null) => void;
}) {
  const { sessionId, fallbackAgent, onFallbackAgentChange } = input;
  const selection = useSessionAgentStore((state) => sessionId && Object.hasOwn(state.bySessionId, sessionId)
    ? state.bySessionId[sessionId]
    : undefined);
  // Adopt the existing preference once, not whenever another new task changes
  // it. Adoption is tracked separately so a runtime snapshot may still replace
  // it, while an explicit choice (even the same value) is never overwritten.
  useEffect(() => {
    if (!sessionId) return;
    useSessionAgentStore.getState().adoptAgent(sessionId, fallbackAgent);
  }, [fallbackAgent, sessionId]);
  const setAgent = useCallback((agent: string | null) => {
    if (sessionId) useSessionAgentStore.getState().setAgent(sessionId, agent);
    else onFallbackAgentChange(agent);
  }, [onFallbackAgentChange, sessionId]);
  return { selectedAgent: selection === undefined ? fallbackAgent : selection, setAgent };
}
