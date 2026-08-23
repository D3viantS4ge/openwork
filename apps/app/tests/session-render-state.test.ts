import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import type { OpenworkSessionSnapshot } from "../src/app/lib/openwork-server";
import {
  deriveRenderedSessionMessages,
  resolveEffectiveRevertState,
} from "../src/react-app/domains/session/surface/session-render-state";

const workspaceId = "workspace-render-state";
const sessionId = "session-render-state";

function textMessage(id: string, role: "user" | "assistant", text: string, created: number): UIMessage {
  return {
    id,
    role,
    metadata: { opencode: { created } },
    parts: [{ type: "text", text, state: "done", providerMetadata: { opencode: { partId: `${id}-part` } } }],
  };
}

function snapshotWith(messages: Array<{ id: string; role: "user" | "assistant"; text: string; created: number }>, opts: {
  revertMessageID?: string | null;
} = {}): OpenworkSessionSnapshot {
  const { revertMessageID } = opts;
  return {
    session: {
      id: sessionId,
      slug: sessionId,
      projectID: "project-render-state",
      directory: "/tmp/project-render-state",
      title: "Render state test",
      version: "1",
      time: { created: 1, updated: 1 },
      ...(revertMessageID ? { revert: { messageID: revertMessageID } } : {}),
    },
    messages: messages.map((message) => ({
      info: {
        id: message.id,
        role: message.role,
        sessionID: sessionId,
        time: { created: message.created },
      },
      parts: [{
        id: `${message.id}-part`,
        sessionID: sessionId,
        messageID: message.id,
        type: "text",
        text: message.text,
      }],
    })),
    todos: [],
    status: { type: "idle" },
  };
}

describe("deriveRenderedSessionMessages", () => {
  test("renders snapshot floor plus live-only messages when no revert cursor", () => {
    const snapshot = snapshotWith([
      { id: "msg-1", role: "user", text: "first", created: 10 },
      { id: "msg-2", role: "assistant", text: "answer", created: 20 },
    ]);
    const live = [
      textMessage("msg-1", "user", "first", 10),
      textMessage("msg-2", "assistant", "answer", 20),
      textMessage("msg-3", "user", "follow-up", 30),
    ];
    const rendered = deriveRenderedSessionMessages({ transcriptState: live, snapshot });
    expect(rendered.map((message) => message.id)).toEqual(["msg-1", "msg-2", "msg-3"]);
  });

  test("hides snapshot messages at/after the revert cursor while the revert is pending", () => {
    const snapshot = snapshotWith(
      [
        { id: "msg-1", role: "user", text: "first", created: 10 },
        { id: "msg-2", role: "assistant", text: "answer", created: 20 },
        { id: "msg-3", role: "user", text: "edited-away", created: 30 },
        { id: "msg-4", role: "assistant", text: "reverted answer", created: 40 },
      ],
      { revertMessageID: "msg-3" },
    );
    // Pending revert: live cache was truncated at the cursor, no replacement yet.
    const live = [
      textMessage("msg-1", "user", "first", 10),
      textMessage("msg-2", "assistant", "answer", 20),
    ];
    const rendered = deriveRenderedSessionMessages({ transcriptState: live, snapshot });
    expect(rendered.map((message) => message.id)).toEqual(["msg-1", "msg-2"]);
  });

  test("keeps the replacement prompt and its streaming output when a stale cursor is re-stamped", () => {
    // The snapshot refetch raced the SSE revert-clear: it still carries the
    // cursor AND the reverted messages, but the live cache already holds the
    // replacement turn. The replacement must not be hidden by the cursor.
    const snapshot = snapshotWith(
      [
        { id: "msg-1", role: "user", text: "first", created: 10 },
        { id: "msg-2", role: "assistant", text: "answer", created: 20 },
        { id: "msg-3", role: "user", text: "edited-away", created: 30 },
        { id: "msg-4", role: "assistant", text: "reverted answer", created: 40 },
      ],
      { revertMessageID: "msg-3" },
    );
    const live = [
      textMessage("msg-1", "user", "first", 10),
      textMessage("msg-2", "assistant", "answer", 20),
      textMessage("msg-5", "user", "replacement prompt", 50),
      textMessage("msg-6", "assistant", "streaming…", 60),
    ];
    const rendered = deriveRenderedSessionMessages({ transcriptState: live, snapshot });
    // Reverted snapshot messages (msg-3, msg-4) stay hidden; the replacement
    // turn (msg-5, msg-6) survives the stale cursor.
    expect(rendered.map((message) => message.id)).toEqual(["msg-1", "msg-2", "msg-5", "msg-6"]);
  });
});

describe("resolveEffectiveRevertState", () => {
  test("reports the cursor while the revert is pending", () => {
    const snapshot = snapshotWith(
      [
        { id: "msg-1", role: "user", text: "first", created: 10 },
        { id: "msg-2", role: "assistant", text: "answer", created: 20 },
        { id: "msg-3", role: "user", text: "edited-away", created: 30 },
      ],
      { revertMessageID: "msg-3" },
    );
    const live = [
      textMessage("msg-1", "user", "first", 10),
      textMessage("msg-2", "assistant", "answer", 20),
    ];
    expect(resolveEffectiveRevertState({ snapshot, liveMessages: live })).toEqual({
      revertMessageId: "msg-3",
      hiddenCount: 1,
    });
  });

  test("suppresses the banner once the replacement prompt is live", () => {
    const snapshot = snapshotWith(
      [
        { id: "msg-1", role: "user", text: "first", created: 10 },
        { id: "msg-2", role: "assistant", text: "answer", created: 20 },
        { id: "msg-3", role: "user", text: "edited-away", created: 30 },
      ],
      { revertMessageID: "msg-3" },
    );
    const live = [
      textMessage("msg-1", "user", "first", 10),
      textMessage("msg-2", "assistant", "answer", 20),
      textMessage("msg-5", "user", "replacement prompt", 50),
      textMessage("msg-6", "assistant", "streaming…", 60),
    ];
    expect(resolveEffectiveRevertState({ snapshot, liveMessages: live })).toEqual({
      revertMessageId: null,
      hiddenCount: 0,
    });
  });

  test("returns no cursor when the snapshot has none", () => {
    const snapshot = snapshotWith([
      { id: "msg-1", role: "user", text: "first", created: 10 },
    ]);
    expect(resolveEffectiveRevertState({ snapshot, liveMessages: [] })).toEqual({
      revertMessageId: null,
      hiddenCount: 0,
    });
  });
});
