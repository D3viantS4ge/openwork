import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

describe("GET /status", () => {
  test("advertises the workspace server platform so clients can validate file part URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-status-"));
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

    const response = await fetch(`http://127.0.0.1:${server.port}/status`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { server?: { platform?: unknown } };
    // The engine spawned by this server runs on process.platform; clients use
    // this field instead of the browser platform to judge `file://` URLs.
    expect(payload.server?.platform).toBe(process.platform);
  });
});
