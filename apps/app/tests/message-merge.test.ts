import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import { mergeSnapshotAndLiveMessages } from "../src/react-app/domains/session/sync/message-merge";

function reasoningMessage(reasoningText: string, bashState: "input-streaming" | "output-available"): UIMessage {
  return {
    id: "msg-a",
    role: "assistant",
    parts: [
      { type: "reasoning", text: reasoningText, state: "streaming", providerMetadata: { opencode: { partId: "prt-reason" } } },
      {
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "call-bash",
        state: bashState,
        input: { command: "ls", description: "List files" },
        output: bashState === "output-available" ? "file1\nfile2" : undefined,
        metadata: { exit: 0 },
        callProviderMetadata: { opencode: { partId: "prt-bash" } },
      } as never,
    ],
  };
}

// The live cache can legitimately hold the same parts in a different order /
// shape than the snapshot: a tool part is deferred until its input arrives,
// so its declaration can land after the reasoning part even when the server
// stored them the other way round.
describe("mergeSnapshotAndLiveMessages part pairing", () => {
  test("keeps longer live reasoning when the snapshot pairs it against a tool part by position", () => {
    // Snapshot: [bash, reasoning("SNIP")] — reasoning at index 1.
    // Live: [reasoning("FULLREASONING"), bash(running)] — reasoning at index 0.
    const snapshot = reasoningMessage("SNIP", "output-available");
    const live = reasoningMessage("FULLREASONING", "input-streaming");

    const merged = mergeSnapshotAndLiveMessages([snapshot], [live], { appendLiveOnlyMessages: true });
    const reasoning = merged[0]?.parts.find((part) => part.type === "reasoning");
    const bash = merged[0]?.parts.find((part) => part.type === "dynamic-tool");

    // The longer live thinking must not be truncated to the snapshot's short
    // text just because the parts sit at different positions.
    expect((reasoning as { text?: string }).text).toBe("FULLREASONING");
    // And the snapshot's terminal tool state must settle the running part.
    expect((bash as { state?: string }).state).toBe("output-available");
  });

  test("settles a running tool part from the snapshot regardless of part order", () => {
    // Snapshot: [bash(completed), reasoning("")], Live: [reasoning("AB"), bash(running)].
    const snapshot: UIMessage = {
      id: "msg-a",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "bash",
          toolCallId: "call-bash",
          state: "output-available",
          input: { command: "ls", description: "List files" },
          output: "file1\nfile2",
          metadata: { exit: 0 },
          callProviderMetadata: { opencode: { partId: "prt-bash" } },
        } as never,
        { type: "reasoning", text: "", state: "done", providerMetadata: { opencode: { partId: "prt-reason" } } },
      ],
    };
    const live = reasoningMessage("AB", "input-streaming");

    const merged = mergeSnapshotAndLiveMessages([snapshot], [live], { appendLiveOnlyMessages: true });
    const bash = merged[0]?.parts.find((part) => part.type === "dynamic-tool");

    expect((bash as { state?: string }).state).toBe("output-available");
    expect((bash as { output?: string }).output).toBe("file1\nfile2");
  });

  test("preserves live-only parts the snapshot does not have yet", () => {
    // Snapshot: [reasoning("")] — the answer text part isn't persisted yet.
    // Live: [reasoning("ABCD"), text("streaming answer")].
    const snapshot: UIMessage = {
      id: "msg-a",
      role: "assistant",
      parts: [{ type: "reasoning", text: "", state: "done", providerMetadata: { opencode: { partId: "prt-reason" } } }],
    };
    const live: UIMessage = {
      id: "msg-a",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "ABCD", state: "streaming", providerMetadata: { opencode: { partId: "prt-reason" } } },
        { type: "text", text: "streaming answer", state: "streaming", providerMetadata: { opencode: { partId: "prt-text" } } },
      ],
    };

    const merged = mergeSnapshotAndLiveMessages([snapshot], [live], { appendLiveOnlyMessages: true });
    const parts = merged[0]?.parts ?? [];

    expect(parts.map((part) => part.type)).toEqual(["reasoning", "text"]);
    expect((parts[0] as { text?: string }).text).toBe("ABCD");
    expect((parts[1] as { text?: string }).text).toBe("streaming answer");
  });
});
