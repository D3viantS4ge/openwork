import { afterEach, describe, expect, jest, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";
import type { UIMessage } from "ai";

import { getReactQueryClient } from "../src/react-app/infra/query-client";
import {
  __applySessionSyncEventForTest,
  __createWorkspaceSessionSyncForTest,
  trackWorkspaceSessionSync,
  transcriptKey,
} from "../src/react-app/domains/session/sync/session-sync";

afterEach(() => {
  jest.useRealTimers();
  getReactQueryClient().clear();
});

function reasoningPart(text: string): Extract<Part, { type: "reasoning" }> {
  return {
    id: "prt-reason",
    sessionID: "session-a",
    messageID: "msg-a",
    type: "reasoning",
    text,
  } as Extract<Part, { type: "reasoning" }>;
}

function readReasoningText(workspaceId: string, sessionId: string) {
  const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey(workspaceId, sessionId));
  return (transcript?.[0]?.parts[0] as { text?: string } | undefined)?.text;
}

describe("session sync retention while a run is live", () => {
  test("keeps applying reasoning deltas after the retained-session timer fires mid-stream", async () => {
    // A retained (switched-away) session's session.status busy event shrinks its
    // retention to 10s, but the run can stream reasoning for far longer without
    // any further status transition. When that 10s timer fires mid-stream the
    // session must stay tracked — untracking it drops every subsequent delta and
    // truncates the thinking to whatever streamed before the timer fired.
    const syncInput = { workspaceId: "workspace-a", baseUrl: "http://127.0.0.1:1234", openworkToken: "token" };
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const release = trackWorkspaceSessionSync(syncInput, "session-a");

    try {
      __applySessionSyncEventForTest(syncInput, {
        type: "message.updated",
        properties: { info: { id: "msg-a", role: "assistant", sessionID: "session-a" } },
      } as never);
      __applySessionSyncEventForTest(syncInput, {
        type: "message.part.updated",
        properties: { part: reasoningPart("") },
      } as never);

      // Switch away: the session becomes retained, then the run's busy status
      // shrinks retention to 10s.
      jest.useFakeTimers();
      release();
      __applySessionSyncEventForTest(syncInput, {
        type: "session.status",
        properties: { sessionID: "session-a", status: { type: "busy" } },
      } as never);

      // Fire the retained-session timer while the run is still live.
      jest.advanceTimersByTime(10_001);
      jest.useRealTimers();

      __applySessionSyncEventForTest(syncInput, {
        type: "message.part.delta",
        properties: { sessionID: "session-a", messageID: "msg-a", partID: "prt-reason", field: "text", delta: "AAAA" },
      } as never);
      await Promise.resolve();

      expect(readReasoningText("workspace-a", "session-a")).toBe("AAAA");
    } finally {
      jest.useRealTimers();
      release();
      cleanup();
    }
  });

  test("untracks the retained session once its run ends", async () => {
    // The live-run re-arm must not leak: after the run reports idle, a later
    // retention expiry untracks for real, so post-run events are dropped.
    const syncInput = { workspaceId: "workspace-a", baseUrl: "http://127.0.0.1:1234", openworkToken: "token" };
    const cleanup = __createWorkspaceSessionSyncForTest(syncInput);
    const release = trackWorkspaceSessionSync(syncInput, "session-a");

    try {
      __applySessionSyncEventForTest(syncInput, {
        type: "message.updated",
        properties: { info: { id: "msg-a", role: "assistant", sessionID: "session-a" } },
      } as never);
      __applySessionSyncEventForTest(syncInput, {
        type: "message.part.updated",
        properties: { part: reasoningPart("") },
      } as never);

      jest.useFakeTimers();
      release();
      __applySessionSyncEventForTest(syncInput, {
        type: "session.status",
        properties: { sessionID: "session-a", status: { type: "busy" } },
      } as never);
      jest.advanceTimersByTime(10_001);
      // Run ends: idle clears runActive and re-arms a 10s idle retention.
      __applySessionSyncEventForTest(syncInput, {
        type: "session.status",
        properties: { sessionID: "session-a", status: { type: "idle" } },
      } as never);
      jest.advanceTimersByTime(10_001);
      jest.useRealTimers();

      __applySessionSyncEventForTest(syncInput, {
        type: "message.part.delta",
        properties: { sessionID: "session-a", messageID: "msg-a", partID: "prt-reason", field: "text", delta: "AAAA" },
      } as never);
      await Promise.resolve();

      expect(readReasoningText("workspace-a", "session-a")).toBe("");
    } finally {
      jest.useRealTimers();
      release();
      cleanup();
    }
  });
});
