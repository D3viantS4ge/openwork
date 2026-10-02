import type { ModelRef } from "@/app/types";
import { modelEquals, parseModelRef } from "@/app/utils";

export type RunPromptOverrides = {
  model?: ModelRef;
  variant?: string;
  agent?: string;
};

/**
 * Minimal agent shape for `/run` default resolution. Normalizes the legacy
 * agent list (`name`, `model.providerID/modelID`, top-level `variant`) and the
 * v2 agent shape (`id`, `model.providerID/id/variant`).
 */
export type RunPromptAgentInfo = {
  name?: string;
  id?: string;
  model?: {
    providerID?: string;
    modelID?: string;
    id?: string;
    variant?: string | null;
  } | null;
  variant?: string | null;
};

export type RunPromptRequest = {
  message: string;
  overrides: RunPromptOverrides;
};

/**
 * Parse a `/run` deep-link query string into a message plus optional
 * model/agent/variant overrides.
 * Returns null when no message is present.
 */
export function parseRunPromptRequest(search: string): RunPromptRequest | null {
  const params = new URLSearchParams(search);
  const message = (params.get("message") ?? "").trim();
  if (!message) return null;

  const overrides: RunPromptOverrides = {};
  const modelParam = params.get("model")?.trim();
  if (modelParam) {
    const model = parseModelRef(modelParam);
    if (model) overrides.model = model;
  }
  const agentParam = params.get("agent")?.trim();
  if (agentParam) overrides.agent = agentParam;
  const variantParam = params.get("variant")?.trim();
  if (variantParam) overrides.variant = variantParam;

  return { message, overrides };
}

function agentModelRef(agent: RunPromptAgentInfo): ModelRef | null {
  const providerID = agent.model?.providerID?.trim();
  const modelID = (agent.model?.modelID ?? agent.model?.id)?.trim();
  return providerID && modelID ? { providerID, modelID } : null;
}

function agentVariant(agent: RunPromptAgentInfo): string | null {
  const variant = (agent.variant ?? agent.model?.variant)?.trim();
  return variant ? variant : null;
}

/**
 * Fill omitted model/variant overrides from a named agent's configured
 * properties. Matches engine prompt resolution: the agent's variant only
 * applies when the effective model is the agent's own model, so an agent with
 * a variant but no model never contributes a variant. Explicit query params
 * always win.
 */
export function withRunPromptAgentDefaults(
  overrides: RunPromptOverrides,
  agent: RunPromptAgentInfo | null | undefined,
): RunPromptOverrides {
  if (!agent) return overrides;
  const agentModel = agentModelRef(agent);
  const model = overrides.model ?? agentModel ?? undefined;
  const variant = overrides.variant
    ?? (agentModel && model && modelEquals(model, agentModel) ? agentVariant(agent) : null)
    ?? undefined;
  return {
    ...overrides,
    ...(model ? { model } : {}),
    ...(variant ? { variant } : {}),
  };
}

/**
 * Resolve `/run` overrides against the workspace's agent list. Best-effort:
 * when the list cannot be loaded, the parsed overrides are used as-is so the
 * run is never blocked by a failed lookup.
 */
export async function resolveRunPromptAgentOverrides(
  overrides: RunPromptOverrides,
  loadAgents: () => Promise<RunPromptAgentInfo[]>,
): Promise<RunPromptOverrides> {
  const agentName = overrides.agent;
  if (!agentName || (overrides.model && overrides.variant)) return overrides;
  try {
    const agents = await loadAgents();
    const agent = agents.find((entry) => entry.name === agentName || entry.id === agentName);
    return withRunPromptAgentDefaults(overrides, agent);
  } catch {
    return overrides;
  }
}
