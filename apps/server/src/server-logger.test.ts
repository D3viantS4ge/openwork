import { describe, expect, test } from "bun:test";

import { createServerLogger } from "./server.js";
import type { ServerConfig } from "./types.js";

function serverConfig(logFormat: ServerConfig["logFormat"] = "pretty"): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "client-token",
    hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 30000 },
    corsOrigins: ["*"],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat,
    logRequests: true,
  };
}

function brokenPipeError() {
  const error = new Error("write EPIPE");
  Object.defineProperty(error, "code", { value: "EPIPE", enumerable: true });
  return error;
}

describe("createServerLogger", () => {
  test("disables log writes after stdout closes", () => {
    let attempts = 0;
    const logger = createServerLogger(serverConfig(), () => {
      attempts += 1;
      throw brokenPipeError();
    });

    expect(() => logger.log("info", "GET / 200 1ms")).not.toThrow();
    expect(() => logger.log("info", "GET /again 200 1ms")).not.toThrow();
    expect(attempts).toBe(1);
  });

  test("still throws unexpected log write failures", () => {
    const logger = createServerLogger(serverConfig(), () => {
      throw new Error("unexpected stdout failure");
    });

    expect(() => logger.log("info", "GET / 200 1ms")).toThrow("unexpected stdout failure");
  });
});
