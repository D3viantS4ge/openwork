import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";

import type { OpenworkSessionMessage } from "../src/app/lib/openwork-server";
import {
  committedTurnTokens,
  estimatePendingShellContextTokens,
  estimateTextTokens,
} from "../src/react-app/domains/session/surface/context-tokens";
import { SHELL_SYNTHETIC_USER_TEXT } from "../src/react-app/domains/session/sync/usechat-adapter";

const SESSION_ID = "session-1";

type AssistantTokens = {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
};

function user(id: string, parts: Part[]): OpenworkSessionMessage {
  return {
    info: {
      id,
      sessionID: SESSION_ID,
      role: "user",
      time: { created: 1 },
      agent: "openwork",
      model: { providerID: "provider", modelID: "model" },
    },
    parts,
  };
}

function assistant(id: string, tokens: AssistantTokens | undefined, parts: Part[] = []): OpenworkSessionMessage {
  return {
    info: {
      id,
      sessionID: SESSION_ID,
      role: "assistant",
      time: { created: 2 },
      parentID: "parent",
      modelID: "model",
      providerID: "provider",
      mode: "openwork",
      agent: "openwork",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts,
  };
}

/** A model turn that committed usage (the stats boundary). */
function committed(id: string, input: number, output = 0): OpenworkSessionMessage {
  return assistant(id, { input, output, reasoning: 0, cache: { read: 0, write: 0 } });
}

function textPart(messageID: string, text: string, synthetic = false): Part {
  return {
    type: "text",
    id: `part-${messageID}`,
    sessionID: SESSION_ID,
    messageID,
    text,
    ...(synthetic ? { synthetic: true } : {}),
  };
}

function bashToolPart(
  command: string,
  output: string,
  state: "completed" | "running" | "error" | "pending" = "completed",
  interrupted = false,
): Part {
  const base = { type: "tool" as const, id: "part-bash", sessionID: SESSION_ID, messageID: "assistant-shell", callID: "call-shell", tool: "bash" };
  if (state === "completed") {
    return { ...base, state: { status: "completed", input: { command }, output, title: "", metadata: {}, time: { start: 1, end: 2 } } };
  }
  if (state === "running") {
    return { ...base, state: { status: "running", input: { command }, metadata: { output }, time: { start: 1 } } };
  }
  if (state === "error") {
    return { ...base, state: { status: "error", input: { command }, error: "boom", metadata: { interrupted, output }, time: { start: 1, end: 2 } } };
  }
  return { ...base, state: { status: "pending", input: { command }, raw: "" } };
}

/** The engine's user `!` shell turn: a synthetic user message plus a zero-token assistant bash message. */
function shellTurn(
  command: string,
  output: string,
  state: "completed" | "running" | "error" | "pending" = "completed",
  interrupted = false,
): OpenworkSessionMessage[] {
  return [
    user("user-shell", [textPart("user-shell", SHELL_SYNTHETIC_USER_TEXT, true)]),
    assistant("assistant-shell", undefined, [bashToolPart(command, output, state, interrupted)]),
  ];
}

describe("estimateTextTokens", () => {
  test("estimates four characters per token", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateTextTokens("abcdef")).toBe(2);
  });
});

describe("committedTurnTokens", () => {
  test("sums inclusive input and output for an assistant message", () => {
    const message = assistant("assistant-1", { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 3 } });
    expect(committedTurnTokens(message)).toBe(120);
  });

  test("returns null for a zero-token assistant message", () => {
    expect(committedTurnTokens(assistant("assistant-shell", undefined))).toBeNull();
  });

  test("returns null for a user message", () => {
    expect(committedTurnTokens(user("user-1", []))).toBeNull();
  });

  test("returns null when tokens are missing (v2-mapped messages)", () => {
    // The v2 adapter maps assistant messages without token usage; the guard
    // keeps the stats computation from crashing on them.
    const message = {
      info: { id: "assistant-v2", sessionID: SESSION_ID, role: "assistant", time: { created: 1 } },
      parts: [],
    } as unknown as OpenworkSessionMessage;
    expect(committedTurnTokens(message)).toBeNull();
  });
});

describe("estimatePendingShellContextTokens", () => {
  test("estimates a completed ! shell turn after the last committed turn", () => {
    const messages = [committed("assistant-1", 100, 20), ...shellTurn("ls -la", "file.txt\n")];
    expect(estimatePendingShellContextTokens(messages)).toBe(
      estimateTextTokens("ls -la") + estimateTextTokens("file.txt\n"),
    );
  });

  test("sums consecutive ! shell turns", () => {
    const messages = [committed("assistant-1", 100), ...shellTurn("ls", "a\n"), ...shellTurn("pwd", "/tmp\n")];
    expect(estimatePendingShellContextTokens(messages)).toBe(
      estimateTextTokens("ls") + estimateTextTokens("a\n") + estimateTextTokens("pwd") + estimateTextTokens("/tmp\n"),
    );
  });

  test("does not double count a ! turn once the next model turn commits", () => {
    // The committed turn's input already contains the shell command and
    // output, so the estimate must drop to zero instead of adding to it.
    const messages = [committed("assistant-1", 100), ...shellTurn("ls -la", "file.txt\n"), committed("assistant-2", 130, 10)];
    expect(estimatePendingShellContextTokens(messages)).toBe(0);
  });

  test("returns 0 when no assistant turn has committed usage", () => {
    expect(estimatePendingShellContextTokens(shellTurn("ls", "a\n"))).toBe(0);
  });

  test("counts a running shell part's streamed output", () => {
    const messages = [committed("assistant-1", 100), ...shellTurn("sleep 1", "partial\n", "running")];
    expect(estimatePendingShellContextTokens(messages)).toBe(
      estimateTextTokens("sleep 1") + estimateTextTokens("partial\n"),
    );
  });

  test("counts only interrupted output for an error shell part", () => {
    const failed = [committed("assistant-1", 100), ...shellTurn("false", "boom\n", "error", false)];
    expect(estimatePendingShellContextTokens(failed)).toBe(estimateTextTokens("false"));
    const interrupted = [committed("assistant-1", 100), ...shellTurn("false", "boom\n", "error", true)];
    expect(estimatePendingShellContextTokens(interrupted)).toBe(
      estimateTextTokens("false") + estimateTextTokens("boom\n"),
    );
  });

  test("ignores a zero-token bash turn that is not a user ! run", () => {
    const messages = [
      committed("assistant-1", 100),
      user("user-2", [textPart("user-2", "run a command")]),
      assistant("assistant-2", undefined, [bashToolPart("ls", "a\n")]),
    ];
    expect(estimatePendingShellContextTokens(messages)).toBe(0);
  });

  test("ignores a synthetic user message with different text", () => {
    const messages = [
      committed("assistant-1", 100),
      user("user-shell", [textPart("user-shell", "not the marker", true)]),
      assistant("assistant-shell", undefined, [bashToolPart("ls", "a\n")]),
    ];
    expect(estimatePendingShellContextTokens(messages)).toBe(0);
  });

  test("returns 0 for an empty message list", () => {
    expect(estimatePendingShellContextTokens([])).toBe(0);
  });
});
