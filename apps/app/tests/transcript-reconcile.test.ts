import { describe, expect, test } from "bun:test";

import type { UIMessage } from "ai";

import {
  applyRevertCursor,
  extendsPastRevertCursor,
  reconcileTranscriptMessages,
} from "../src/react-app/domains/session/sync/transcript-reconcile";

function message(id: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text: id }] };
}

describe("extendsPastRevertCursor", () => {
  test("false when there is no revert cursor", () => {
    expect(extendsPastRevertCursor([message("m1"), message("m2")], null)).toBe(false);
    expect(extendsPastRevertCursor([], "m1")).toBe(false);
  });

  test("false when the cursor message is the last message", () => {
    expect(extendsPastRevertCursor([message("m1"), message("m2")], "m2")).toBe(false);
  });

  test("true when messages exist after the cursor", () => {
    expect(extendsPastRevertCursor([message("m1"), message("m2"), message("m3")], "m1")).toBe(true);
  });

  test("false when the cursor message is not in the transcript", () => {
    expect(extendsPastRevertCursor([message("m1"), message("m2")], "missing")).toBe(false);
  });
});

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

  test("fills an empty cache from the snapshot", () => {
    const result = reconcileTranscriptMessages({
      currentMessages: [],
      snapshotMessages: [message("m1"), message("m2")],
    });
    expect(result.map((item) => item.id)).toEqual(["m1", "m2"]);
  });
});
