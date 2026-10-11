import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { notifyManager, QueryClientProvider } from "@tanstack/react-query";
import type { Part } from "@opencode-ai/sdk/v2/client";
import type { UIMessage } from "ai";

import type { Client, PendingPermission } from "../src/app/types";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { transcriptKey } from "../src/react-app/domains/session/sync/session-sync";
import {
  selectPermissionToolInput,
  toolInputFromParts,
  toolInputFromUIMessages,
  usePermissionToolInput,
} from "../src/react-app/domains/session/sync/use-permission-tool-input";

GlobalRegistrator.register({ url: "http://localhost/" });
const previousAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
notifyManager.setScheduler(queueMicrotask);

const WORKSPACE_ID = "workspace-1";

function permission(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return {
    id: "permission-1",
    sessionID: "session-1",
    permission: "calibress_curl",
    patterns: ["*"],
    metadata: {},
    always: ["*"],
    tool: { messageID: "msg-1", callID: "call-1" },
    receivedAt: 1,
    protocol: "legacy",
    ...overrides,
  };
}

function rawToolPart(input: Record<string, unknown>, callID = "call-1"): Part {
  return {
    type: "tool",
    id: "part-1",
    sessionID: "session-1",
    messageID: "msg-1",
    callID,
    tool: "calibress_curl",
    state: { status: "completed", input, output: "ok", title: "", metadata: {}, time: { start: 1, end: 2 } },
  };
}

function uiMessageWithTool(input: unknown, callID = "call-1"): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName: "calibress_curl",
      toolCallId: callID,
      state: "output-available",
      input,
      output: "ok",
    }],
  };
}

const args = { method: "GET", url: "https://raw.githubusercontent.com/de4dot/de4dot/master/README.md" };

describe("toolInputFromUIMessages", () => {
  test("returns the tool part input for the permission's call", () => {
    expect(toolInputFromUIMessages([uiMessageWithTool(args)], { messageID: "msg-1", callID: "call-1" })).toEqual(args);
  });

  test("returns null when the message or call is not in the transcript", () => {
    expect(toolInputFromUIMessages([uiMessageWithTool(args)], { messageID: "other-msg", callID: "call-1" })).toBeNull();
    expect(toolInputFromUIMessages([uiMessageWithTool(args)], { messageID: "msg-1", callID: "other-call" })).toBeNull();
    expect(toolInputFromUIMessages([], { messageID: "msg-1", callID: "call-1" })).toBeNull();
  });

  test("returns null when the part input is not a record", () => {
    expect(toolInputFromUIMessages([uiMessageWithTool("not-an-object")], { messageID: "msg-1", callID: "call-1" })).toBeNull();
  });
});

describe("toolInputFromParts", () => {
  test("returns the raw tool part input for the call", () => {
    expect(toolInputFromParts([rawToolPart(args)], "call-1")).toEqual(args);
  });

  test("returns null when the call is missing", () => {
    expect(toolInputFromParts([rawToolPart(args)], "other-call")).toBeNull();
    expect(toolInputFromParts([], "call-1")).toBeNull();
  });
});

describe("selectPermissionToolInput", () => {
  const tool = { messageID: "msg-1", callID: "call-1" };

  test("prefers the transcript over fetched parts", () => {
    const transcript = { url: "https://transcript.example" };
    expect(selectPermissionToolInput({
      engineHasDetails: false,
      tool,
      messages: [uiMessageWithTool(transcript)],
      parts: [rawToolPart(args)],
    })).toEqual(transcript);
  });

  test("falls back to fetched parts when the transcript has no part", () => {
    expect(selectPermissionToolInput({
      engineHasDetails: false,
      tool,
      messages: [],
      parts: [rawToolPart(args)],
    })).toEqual(args);
  });

  test("never returns arguments when the engine supplied its own details", () => {
    expect(selectPermissionToolInput({
      engineHasDetails: true,
      tool,
      messages: [uiMessageWithTool(args)],
      parts: [rawToolPart(args)],
    })).toBeNull();
  });

  test("returns null without a tool reference", () => {
    expect(selectPermissionToolInput({
      engineHasDetails: false,
      tool: null,
      messages: [uiMessageWithTool(args)],
      parts: [rawToolPart(args)],
    })).toBeNull();
  });
});

describe("usePermissionToolInput", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  function Probe(props: { client: Client | null; pending: PendingPermission | null }) {
    const input = usePermissionToolInput({
      client: props.client,
      workspaceId: WORKSPACE_ID,
      permission: props.pending,
    });
    return <output data-input>{JSON.stringify(input)}</output>;
  }

  async function renderProbe(client: Client | null, pending: PendingPermission | null) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const queryClient = getReactQueryClient();
    await act(async () => {
      root!.render(
        <QueryClientProvider client={queryClient}>
          <Probe client={client} pending={pending} />
        </QueryClientProvider>,
      );
    });
  }

  async function waitForOutput(predicate: (value: string) => boolean) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = container?.querySelector("[data-input]")?.textContent ?? "";
      if (predicate(value)) return value;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    throw new Error(`Timed out waiting for tool input; last value: ${container?.querySelector("[data-input]")?.textContent}`);
  }

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    getReactQueryClient().clear();
  });

  test("reads the arguments from the cached transcript without fetching", async () => {
    getReactQueryClient().setQueryData(transcriptKey(WORKSPACE_ID, "session-1"), [uiMessageWithTool(args)]);
    const fetchMessage = mock(async () => { throw new Error("must not fetch when the transcript is cached"); });
    const client = { session: { message: fetchMessage } } as unknown as Client;

    await renderProbe(client, permission());
    expect(await waitForOutput((value) => value.includes(args.url))).toContain('"method":"GET"');
    expect(fetchMessage).not.toHaveBeenCalled();
  });

  test("fetches the message from the engine when the transcript is not cached", async () => {
    const fetchMessage = mock(async () => ({ data: { info: { id: "msg-1" }, parts: [rawToolPart(args)] } }));
    const client = { session: { message: fetchMessage } } as unknown as Client;

    await renderProbe(client, permission());
    expect(await waitForOutput((value) => value.includes(args.url))).toContain('"method":"GET"');
    expect(fetchMessage).toHaveBeenCalledTimes(1);
    expect(fetchMessage.mock.calls[0]?.[0]).toMatchObject({ sessionID: "session-1", messageID: "msg-1" });
  });

  test("skips the lookup when the engine metadata already carries review details", async () => {
    getReactQueryClient().setQueryData(transcriptKey(WORKSPACE_ID, "session-1"), [uiMessageWithTool(args)]);
    const fetchMessage = mock(async () => { throw new Error("must not fetch for engine details"); });
    const client = { session: { message: fetchMessage } } as unknown as Client;

    await renderProbe(client, permission({ metadata: { command: "rm -rf dist" } }));
    expect(container?.querySelector("[data-input]")?.textContent).toBe("null");
    expect(fetchMessage).not.toHaveBeenCalled();
  });
});

afterAll(async () => {
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
  await GlobalRegistrator.unregister();
});
