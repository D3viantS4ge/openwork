/**
 * Reads the engine-provided OpenCode client (from a plugin's factory input) to
 * resolve whether the current session's agent opts out of OpenWork context via
 * its `openwork` agent option. Shared by the OpenWork system-prompt plugins so
 * they can skip the OpenWork instructions when the agent declares `openwork:
 * false` (e.g. the `plain` agent).
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type OpenWorkEngineAgentContext = {
  /** Resolve the current agent name for a session (undefined when unknown). */
  sessionAgent: (sessionID: string) => Promise<string | undefined>;
  /** Whether the given agent keeps OpenWork context enabled (default true). */
  isOpenworkEnabled: (agentName: string) => Promise<boolean>;
};

/** Extract a non-empty `sessionID` string from a system-transform hook input. */
export function readSessionID(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const sessionID = input.sessionID;
  return typeof sessionID === "string" && sessionID ? sessionID : undefined;
}

export function readEngineAgentContext(value: unknown): OpenWorkEngineAgentContext | undefined {
  const client = isRecord(value) ? value.client : undefined;
  const session = isRecord(client) ? client.session : undefined;
  const sessionGet = isRecord(session) && typeof session.get === "function" ? session.get : undefined;
  const app = isRecord(client) ? client.app : undefined;
  const appAgents = isRecord(app) && typeof app.agents === "function" ? app.agents : undefined;
  if (!sessionGet || !appAgents) return undefined;

  return {
    sessionAgent: async (sessionID) => {
      try {
        const result = await sessionGet.call(session, { sessionID });
        const agent = isRecord(result) ? result.agent : undefined;
        return typeof agent === "string" && agent ? agent : undefined;
      } catch {
        return undefined;
      }
    },
    isOpenworkEnabled: async (agentName) => {
      try {
        const list = await appAgents.call(app);
        if (!Array.isArray(list)) return true;
        const agent = list.find((item) => isRecord(item) && item.name === agentName);
        const options = isRecord(agent) ? agent.options : undefined;
        return !(isRecord(options) && options.openwork === false);
      } catch {
        return true;
      }
    },
  };
}
