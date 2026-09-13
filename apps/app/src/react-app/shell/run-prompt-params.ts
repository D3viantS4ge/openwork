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
  /** If true, the session will be archived immediately after creation (or after
   *  the message is queued for an existing session). Accepts "true", "1", "yes". */
  archive?: boolean;
};

/**
 * Parse a `/run` deep-link query string into a message plus optional
 * model/agent/variant overrides and an archive flag.
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

  const archive = parseBooleanParam(params.get("archive"));

  return { message, overrides, archive };
}

/** Parse a URL query parameter as a boolean. Returns `true` for "true", "1", "yes";
 *  `false` for "false", "0", "no"; `undefined` when absent or unrecognised. */
function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return undefined;
}
