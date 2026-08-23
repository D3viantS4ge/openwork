import { describe, expect, test } from "bun:test";

import type { UIMessage } from "ai";

import {
  applyRevertCursor,
  reconcileTranscriptMessages,
} from "../src/react-app/domains/session/sync/transcript-reconcile";

function message(id: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text: id }] };
}

describe("applyRevertCursor", () => {
  test("slices messages at and after the cursor", () => {
    const result = applyRevertCursor([message("m1"), message("m2"), message("m3")], "m2");
    expect(result.map((item) => item.id)).toEqual(["m1"]);
  });

  test("is a no-op without a cursor", () => {
    expect(applyRevertCursor([message("m1")], null)).toHaveLength(1);
  });
});

describe("reconcileTranscriptMessages", () => {
  test("preserves cached-only messages when the snapshot lags (snapshot must not move the transcript backwards)", () => {
    // The post-revert prompt's message reached the cache via the event stream,
    // but a lagging snapshot does not contain it yet.
    const snapshotMessages = [message("m1"), message("m2")];
    const cachedMessages = [message("m1"), message("m2"), message("m3-new")];
    const result = reconcileTranscriptMessages({ currentMessages: cachedMessages, snapshotMessages });
    expect(result.map((item) => item.id)).toEqual(["m1", "m2", "m3-new"]);
  });

  test("drops stale snapshot messages at/after the revert cursor while keeping cached-only post-revert messages", () => {
    // The replacement prompt (m3-new) is in the cache; a stale snapshot read
    // before the prompt still carries the reverted m2 AND the cursor.
    const snapshotMessages = [message("m1"), message("m2"), message("m3-old")];
    const cachedMessages = [message("m1"), message("m3-new")];
    const result = reconcileTranscriptMessages({
      currentMessages: cachedMessages,
      snapshotMessages,
      revertMessageId: "m2",
    });
    expect(result.map((item) => item.id)).toEqual(["m1", "m3-new"]);
  });

  test("drops stale reverted messages from a pre-revert snapshot that has no cursor of its own", () => {
    // A snapshot captured before the revert has no cursor but still carries
    // the reverted m2; the locally-known cursor (from applySessionRevert)
    // filters it out instead of resurrecting it next to the new prompt.
    const snapshotMessages = [message("m1"), message("m2")];
    const cachedMessages = [message("m1"), message("m3-new")];
    const result = reconcileTranscriptMessages({
      currentMessages: cachedMessages,
      snapshotMessages,
      revertMessageId: "m2",
    });
    expect(result.map((item) => item.id)).toEqual(["m1", "m3-new"]);
  });

  test("fills an empty cache from the snapshot", () => {
    const result = reconcileTranscriptMessages({
      currentMessages: [],
      snapshotMessages: [message("m1"), message("m2")],
    });
    expect(result.map((item) => item.id)).toEqual(["m1", "m2"]);
  });
});
