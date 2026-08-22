import { describe, expect, test } from "bun:test";

import { describeCreateWorkspaceError } from "../src/app/lib/workspace-create-error";
import { OpenworkServerError } from "../src/app/lib/openwork-server";

describe("describeCreateWorkspaceError", () => {
  test("surfaces the server's structured message", () => {
    const error = new OpenworkServerError(
      400,
      "path_not_creatable",
      "Could not create workspace folder at /data/ws: permission denied",
      { path: "/data/ws", reason: "EACCES" },
    );
    expect(describeCreateWorkspaceError(error)).toBe(
      "Could not create workspace folder at /data/ws: permission denied",
    );
  });

  test("passes through absolute-path validation errors", () => {
    const error = new OpenworkServerError(
      400,
      "invalid_path",
      "folderPath must be an absolute path on this server",
    );
    expect(describeCreateWorkspaceError(error)).toBe(
      "folderPath must be an absolute path on this server",
    );
  });

  test("falls back to the raw message for non-server errors", () => {
    expect(describeCreateWorkspaceError(new Error("boom"))).toBe("boom");
  });

  test("falls back to a generic message when there is no message", () => {
    expect(describeCreateWorkspaceError(null)).toBe("Could not create the workspace.");
  });
});
