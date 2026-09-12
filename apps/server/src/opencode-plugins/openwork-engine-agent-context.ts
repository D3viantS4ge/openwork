/**
 * Reads the engine-provided OpenCode client (from a plugin's factory input) to
 * resolve whether the current session's agent opts out of OpenWork context.
 * Shared by the OpenWork system-prompt plugins so they can skip the OpenWork
 * instructions for agents that declare `disable_openwork: true` in their
 * options, or for the built-in plain agent.
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
        const result = await sessionGet.call(session, { path: { id: sessionID } });
        const data = isRecord(result) ? result.data : undefined;
        const agent = isRecord(data) ? data.agent : undefined;
        return typeof agent === "string" && agent ? agent : undefined;
      } catch {
        return undefined;
      }
    },
    isOpenworkEnabled: async (agentName) => {
      // Built-in agents that opt out of OpenWork context.
      if (agentName === "plain") return false;
      try {
        const list = await appAgents.call(app);
        if (!Array.isArray(list)) return true;
        const agent = list.find((item) => isRecord(item) && item.name === agentName);
        const options = isRecord(agent) ? agent.options : undefined;
        return !(isRecord(options) && options.disable_openwork === true);
      } catch {
        return true;
      }
    },
  };
}
