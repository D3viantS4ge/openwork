import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const CLIENT_TOKEN = "owt_runtime_debug_client";
const HOST_TOKEN = "owt_runtime_debug_host";
const roots: string[] = [];
const stops: Array<() => void | Promise<void>> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "openwork-runtime-debug-"));
  roots.push(root);
  return root;
}

async function startOpenworkServer(workspaceRoot: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    configPath: join(workspaceRoot, "server.json"),
    token: CLIENT_TOKEN,
    hostToken: HOST_TOKEN,
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: workspaceRoot, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}`, config };
}

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

describe("debug API endpoint", () => {
  test("echoes all messages and request fields as JSON", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const requestBody = {
      model: "echo",
      messages: [
        { role: "system", content: "You are a debug bot." },
        { role: "user", content: "Hello, debug!" },
        { role: "assistant", content: "I'm a debug echo." },
        { role: "user", content: "Debug this back" },
      ],
      temperature: 0.5,
      max_tokens: 100,
      tools: [
        { type: "function", function: { name: "get_weather", description: "Get weather" } },
      ],
    };

    const response = await fetch(`${base}/api/debug/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(isRecord(body)).toBe(true);
    if (isRecord(body)) {
      expect(body.object).toBe("chat.completion");
      expect(body.model).toBe("echo");
      const choices = Array.isArray(body.choices) ? body.choices : [];
      expect(choices.length).toBe(1);
      if (choices[0]) {
        const message = isRecord(choices[0].message) ? choices[0].message : {};
        const content = typeof message.content === "string" ? message.content : "";
        // The content should be wrapped in a ```json code block
        expect(content.startsWith("```json\n")).toBe(true);
        expect(content.endsWith("\n```")).toBe(true);
        // Extract and parse the JSON payload from inside the code block
        const jsonPart = content.slice(8, -4);
        const echoed: unknown = JSON.parse(jsonPart);
        expect(isRecord(echoed)).toBe(true);
        if (isRecord(echoed)) {
          const debug = isRecord(echoed.debug) ? echoed.debug : {};
          expect(debug.model).toBe("echo");
          expect(Array.isArray(debug.messages)).toBe(true);
          expect(debug.messages).toEqual(requestBody.messages);
          expect(debug.temperature).toBe(0.5);
          expect(debug.max_tokens).toBe(100);
          expect(debug.tools).toEqual(requestBody.tools);
          // stream should be stripped from the debug echo
          expect((debug as Record<string, unknown>).stream).toBeUndefined();
        }
      }
    }
  });

  test("echoes with empty messages array", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/api/debug/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "echo", messages: [] }),
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const choices = Array.isArray(body.choices) ? body.choices : [];
      if (choices[0]) {
        const message = isRecord(choices[0].message) ? choices[0].message : {};
        const content = typeof message.content === "string" ? message.content : "";
        expect(content.startsWith("```json\n")).toBe(true);
        expect(content.endsWith("\n```")).toBe(true);
        const jsonPart = content.slice(8, -4);
        const echoed: unknown = JSON.parse(jsonPart);
        if (isRecord(echoed)) {
          const debug = isRecord(echoed.debug) ? echoed.debug : {};
          expect(debug.model).toBe("echo");
          expect(debug.messages).toEqual([]);
        }
      }
    }
  });

  test("streams the full echoed request as SSE", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const requestBody = {
      model: "echo",
      messages: [
        { role: "system", content: "You are a debug bot." },
        { role: "user", content: "Stream this back" },
      ],
    };

    const response = await fetch(`${base}/api/debug/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody, stream: true }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const text = await response.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
    // The SSE content should include the system message and user message
    expect(text).toContain("You are a debug bot.");
    expect(text).toContain("Stream this back");
    // stream field should NOT be in the echoed payload
    expect(text).not.toMatch(/"stream"/);
    // Should be wrapped in a code block
    expect(text).toContain("```json");
  });

  test("rejects invalid JSON body", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/api/debug/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });

    expect(response.status).toBe(200); // Returns error as JSON body
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const error = isRecord(body.error) ? body.error : {};
      expect(error.message).toBe("Invalid JSON");
    }
  });
});
