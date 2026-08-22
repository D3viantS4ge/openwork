import assert from "node:assert/strict";
import test from "node:test";

import { allocateFreePort } from "@openwork/cdp";
import { startMockMcp } from "../src/mock-mcp.ts";

test("records an unauthenticated initialize attempt as a handshake", async () => {
  await using mock = await startMockMcp({ port: await allocateFreePort() });
  const startedAt = new Date().toISOString();

  const response = await fetch(mock.mcpUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "mock-handshake-test", version: "1.0.0" },
      },
    }),
  });

  assert.equal(response.status, 401);
  const handshakes = await mock.handshakes({ sinceIso: startedAt });
  assert.equal(handshakes.length, 1);
  assert.equal(handshakes[0]?.method, "POST");
  assert.equal(handshakes[0]?.path, "/mcp");
});
