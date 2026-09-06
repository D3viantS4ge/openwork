import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import {
  readGlobalRuntimeOpencodeConfig,
  readRuntimeOpencodeConfig,
  writeRuntimeOpencodeConfig,
} from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

const CLIENT_TOKEN = "owt_runtime_echo_client";
const HOST_TOKEN = "owt_runtime_echo_host";
const roots: string[] = [];
const stops: Array<() => void | Promise<void>> = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clientAuth() {
  return { authorization: `Bearer ${CLIENT_TOKEN}`, "content-type": "application/json" };
}

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "openwork-runtime-echo-"));
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

describe("runtime-config echo-provider route", () => {
  test("enables the echo provider in the global runtime store", async () => {
    const root = await createTempRoot();
    const { base, config } = await startOpenworkServer(root);

    const response = await fetch(`${base}/runtime-config/echo-provider`, {
      method: "POST",
      headers: clientAuth(),
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(isRecord(body) ? body.enabled : null).toBe(true);

    const globalRuntime = await readGlobalRuntimeOpencodeConfig(config);
    const echoProvider = isRecord(globalRuntime.provider) ? globalRuntime.provider.echo : undefined;
    expect(isRecord(echoProvider)).toBe(true);
    if (isRecord(echoProvider)) {
      expect(echoProvider.name).toBe("Debug");
      expect(echoProvider.npm).toBe("@ai-sdk/openai-compatible");
      const models = isRecord(echoProvider.models) ? echoProvider.models : {};
      expect(isRecord(models.echo)).toBe(true);
      if (isRecord(models.echo)) {
        expect(models.echo.id).toBe("echo");
        expect(models.echo.name).toBe("Echo");
      }
    }
  });

  test("disables the echo provider by removing it from the global runtime store", async () => {
    const root = await createTempRoot();
    const { base, config } = await startOpenworkServer(root);

    // First enable
    await fetch(`${base}/runtime-config/echo-provider`, {
      method: "POST",
      headers: clientAuth(),
      body: JSON.stringify({ enabled: true }),
    });

    // Then disable
    const response = await fetch(`${base}/runtime-config/echo-provider`, {
      method: "POST",
      headers: clientAuth(),
      body: JSON.stringify({ enabled: false }),
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(isRecord(body) ? body.enabled : null).toBe(false);

    const globalRuntime = await readGlobalRuntimeOpencodeConfig(config);
    const echoProvider = isRecord(globalRuntime.provider) ? globalRuntime.provider.echo : undefined;
    expect(echoProvider).toBeUndefined();
  });

  test("preserves other runtime keys while enabling echo provider", async () => {
    const root = await createTempRoot();
    const { base, config } = await startOpenworkServer(root);

    // Preseed other runtime keys
    await writeRuntimeOpencodeConfig(config, "ws_1", () => ({
      disabled_providers: ["anthropic"],
      mcp: { notion: { type: "remote", url: "https://notion.example/mcp" } },
    }));

    const response = await fetch(`${base}/runtime-config/echo-provider`, {
      method: "POST",
      headers: clientAuth(),
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(200);

    // Workspace-level keys should be preserved
    const wsRuntime = await readRuntimeOpencodeConfig(config, "ws_1");
    expect(wsRuntime.disabled_providers).toEqual(["anthropic"]);
    expect(wsRuntime.mcp?.notion?.url).toBe("https://notion.example/mcp");
  });

  test("rejects requests without client auth", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/runtime-config/echo-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(401);
  });

  test("rejects invalid JSON body", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/runtime-config/echo-provider`, {
      method: "POST",
      headers: clientAuth(),
      body: "not-json",
    });

    expect(response.status).toBe(400);
  });
});

describe("echo API endpoint", () => {
  test("echoes the last user message as JSON", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/api/echo/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "echo",
        messages: [
          { role: "user", content: "Hello, echo!" },
          { role: "user", content: "Echo this back" },
        ],
      }),
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
        expect(message.content).toBe("Echo this back");
      }
    }
  });

  test("echoes with empty messages", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/api/echo/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "echo",
        messages: [],
      }),
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const choices = Array.isArray(body.choices) ? body.choices : [];
      if (choices[0]) {
        const message = isRecord(choices[0].message) ? choices[0].message : {};
        expect(message.content).toBe("");
      }
    }
  });

  test("streams the echoed message as SSE", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/api/echo/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "echo",
        messages: [{ role: "user", content: "Stream this back" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const text = await response.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
    expect(text).toContain("Stream this back");
  });

  test("rejects invalid JSON body", async () => {
    const root = await createTempRoot();
    const { base } = await startOpenworkServer(root);

    const response = await fetch(`${base}/api/echo/v1/chat/completions`, {
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
