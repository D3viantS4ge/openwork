import type { ModelRef } from "@/app/types";
import { parseModelRef } from "@/app/utils";

export type RunPromptOverrides = {
  model?: ModelRef;
  variant?: string;
  agent?: string;
};

export type RunPromptRequest = {
  message: string;
  overrides: RunPromptOverrides;
};

/**
 * Parse a `/run` deep-link query string into a message plus optional
 * model/agent/variant overrides. Returns null when no message is present.
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
