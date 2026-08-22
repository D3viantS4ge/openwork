import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function startWorkspaceServer() {
  const root = await mkdtemp(join(tmpdir(), "openwork-ws-create-"));
  roots.push(root);
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "manual", timeoutMs: 1_000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  const hostHeaders = { "X-OpenWork-Host-Token": config.hostToken };
  return { base: `http://127.0.0.1:${server.port}`, hostHeaders, root };
}

describe("POST /workspaces/local", () => {
  test("creates a workspace at an absolute path with mkdir -p semantics", async () => {
    const { base, hostHeaders, root } = await startWorkspaceServer();
    // Nested path that does not exist yet: must be created recursively.
    const target = join(root, "nested", "deep", "new-workspace");

    const response = await fetch(`${base}/workspaces/local`, {
      method: "POST",
      headers: { ...hostHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath: target, name: "New Workspace", preset: "starter" }),
    });

    expect(response.status).toBe(201);
    const payload = await response.json() as { activeId: string; workspaces: Array<{ id: string; path: string; name: string }> };
    expect(payload.activeId).toBeTruthy();
    const created = payload.workspaces.find((entry) => entry.path === target);
    expect(created).toBeTruthy();
    expect(created?.name).toBe("New Workspace");
    // The folder was actually created on the server disk (mkdir -p).
    const info = await stat(target);
    expect(info.isDirectory()).toBe(true);
  });

  test("rejects a relative folderPath with invalid_path", async () => {
    const { base, hostHeaders } = await startWorkspaceServer();

    const response = await fetch(`${base}/workspaces/local`, {
      method: "POST",
      headers: { ...hostHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath: "relative/workspace", name: "Rel", preset: "starter" }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as { code: string; message: string };
    expect(payload.code).toBe("invalid_path");
    expect(payload.message).toContain("absolute path");
  });

  test("returns a structured path_not_creatable error when the folder cannot be created", async () => {
    const { base, hostHeaders } = await startWorkspaceServer();
    // /proc rejects mkdir on Linux, giving a deterministic unwritable path.
    const target = "/proc/openwork-ws-create-probe";

    const response = await fetch(`${base}/workspaces/local`, {
      method: "POST",
      headers: { ...hostHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath: target, name: "Probe", preset: "starter" }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json() as { code: string; message: string };
    expect(payload.code).toBe("path_not_creatable");
    expect(payload.message).toContain(target);
  });
});
