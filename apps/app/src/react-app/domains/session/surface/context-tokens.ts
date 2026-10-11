import type { Part } from "@opencode-ai/sdk/v2/client";

import type { OpenworkSessionMessage } from "@/app/lib/openwork-server";
import { isShellSyntheticUserPart } from "../sync/usechat-adapter";

type ToolPart = Extract<Part, { type: "tool" }>;

const CHARS_PER_TOKEN = 4;

/**
 * Rough token count for a string, mirroring the engine's own `Token.estimate`
 * heuristic (chars / 4) used for compaction budgets.
 */
export function estimateTextTokens(text: string): number {
  return Math.max(0, Math.round(text.length / CHARS_PER_TOKEN));
}

/**
 * The engine's committed usage for an assistant message: the turn's total
 * input (fresh + cache read/write) plus total output (visible + reasoning).
 * Returns null when the message is not an assistant message, carries no
 * tokens (v2-mapped messages omit them), or has not committed any usage yet
 * — e.g. the zero-token assistant message of a user `!` shell run.
 */
export function committedTurnTokens(message: OpenworkSessionMessage): number | null {
  const info = message.info;
  if (info.role !== "assistant") return null;
  const tokens = info.tokens;
  if (!tokens) return null;
  const total = tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning;
  return total > 0 ? total : null;
}

/**
 * Estimated tokens of user `!` shell runs that the last committed turn does
 * not cover yet. A shell run commits no usage of its own (it never touches
 * the LLM), so without this estimate the stats bar would not move when a
 * command finishes. Only turns after the newest assistant message with
 * committed usage count: once the next model turn commits, its input already
 * contains the shell command and output, and the estimate drops to zero —
 * it is replaced by the real value, never added to it.
 */
export function estimatePendingShellContextTokens(messages: readonly OpenworkSessionMessage[]): number {
  let committedIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (committedTurnTokens(messages[index]) !== null) {
      committedIndex = index;
      break;
    }
  }
  if (committedIndex === -1) return 0;

  let estimate = 0;
  for (let index = committedIndex + 1; index < messages.length; index += 1) {
    if (!isUserShellTurn(messages, index)) continue;
    for (const part of messages[index].parts) {
      if (part.type === "tool" && part.tool === "bash") estimate += estimateShellToolPartTokens(part);
    }
  }
  return estimate;
}

/** True when the assistant message at `index` is the engine's synthetic `!` shell turn. */
function isUserShellTurn(messages: readonly OpenworkSessionMessage[], index: number): boolean {
  if (messages[index].info.role !== "assistant") return false;
  const previous = messages[index - 1];
  return previous?.info.role === "user" && previous.parts.some(isShellSyntheticUserPart);
}

/** Command + output tokens of a shell tool part, using only output the engine replays. */
function estimateShellToolPartTokens(part: ToolPart): number {
  const command = typeof part.state.input.command === "string" ? part.state.input.command : "";
  return estimateTextTokens(command) + estimateTextTokens(shellToolPartOutput(part.state));
}

function shellToolPartOutput(state: ToolPart["state"]): string {
  if (state.status === "completed") return state.output;
  if (state.status === "running") {
    const output = state.metadata?.output;
    return typeof output === "string" ? output : "";
  }
  if (state.status === "error") {
    const output = state.metadata?.output;
    return state.metadata?.interrupted === true && typeof output === "string" ? output : "";
  }
  return "";
}
