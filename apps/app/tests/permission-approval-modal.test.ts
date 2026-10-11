import { describe, expect, test } from "bun:test";
import { DomUtils, parseDocument } from "htmlparser2";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission } from "../src/app/types";

import {
  PermissionApprovalPanel,
} from "../src/react-app/domains/session/chat/permission-approval-modal";
import {
  permissionDetailRows,
  permissionWithToolInputDetails,
} from "../src/react-app/domains/session/chat/permission-details";

function pendingPermission(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return {
    id: "permission-1",
    sessionID: "session-1",
    permission: "bash",
    patterns: ["rm -rf dist"],
    metadata: {},
    always: {
      session: false,
      project: false,
    },
    receivedAt: 1,
    protocol: "legacy",
    ...overrides,
  };
}

function buttonText(markup: string): string[] {
  const document = parseDocument(markup);
  return DomUtils.findAll((element) => element.name === "button", document.children)
    .map((button) => DomUtils.textContent(button).replace(/\s+/g, " ").trim());
}

describe("permission approval modal helpers", () => {
  test("surfaces risk-bearing metadata as review rows", () => {
    expect(
      permissionDetailRows({
        command: "rm -rf dist",
        description: "Remove build output",
        cwd: "/workspace/project",
        filepath: "/workspace/project/src/app.ts",
        diff: "-old\n+new",
        output: "not shown before approval",
      }).map((row) => [row.label, row.value]),
    ).toEqual([
      ["Command", "rm -rf dist"],
      ["Description", "Remove build output"],
      ["Working directory", "/workspace/project"],
      ["File", "/workspace/project/src/app.ts"],
      ["Diff", "-old\n+new"],
    ]);
  });

  test("deduplicates alternate file metadata keys", () => {
    expect(
      permissionDetailRows({
        filepath: "/workspace/project/a.ts",
        filePath: "/workspace/project/b.ts",
      }).map((row) => [row.label, row.value]),
    ).toEqual([["File", "/workspace/project/a.ts"]]);
  });

  test("summarizes apply-patch file metadata", () => {
    expect(
      permissionDetailRows({
        files: [
          { type: "add", relativePath: "src/new.ts" },
          { type: "delete", filePath: "/workspace/project/src/old.ts" },
          { type: "", path: "src/update.ts" },
        ],
      }).map((row) => [row.label, row.value]),
    ).toEqual([
      ["Files", "add: src/new.ts\ndelete: /workspace/project/src/old.ts\nchange: src/update.ts"],
    ]);
  });

  test("keeps keyboard order on the safer one-shot approval before session approval", () => {
    const html = renderToStaticMarkup(
      React.createElement(PermissionApprovalPanel, {
        permission: pendingPermission(),
        respondPermission: () => {},
      }),
    );

    expect(buttonText(html)).toEqual(["Deny", "Allow once", "Allow for session"]);
  });

  test("uses readable labels for generic permission titles", () => {
    const html = renderToStaticMarkup(
      React.createElement(PermissionApprovalPanel, {
        permission: pendingPermission({ permission: "todowrite" }),
        respondPermission: () => {},
      }),
    );

    expect(html).toContain("Approve Todo write?");
    expect(html).not.toContain("Approve todowrite?");
  });

  test("identifies a permission requested by a child session", () => {
    const html = renderToStaticMarkup(
      React.createElement(PermissionApprovalPanel, {
        permission: pendingPermission({ sessionID: "session-child" }),
        sourceTitle: "Investigate the deployment failure",
        respondPermission: () => {},
      }),
    );

    expect(html).toContain('data-permission-source="child-session"');
    expect(html).toContain("Requested by Investigate the deployment failure");
  });
});

describe("permissionWithToolInputDetails", () => {
  test("merges MCP tool arguments into a permission with no engine details", () => {
    const permission = pendingPermission({ permission: "calibress_curl", metadata: {} });
    const merged = permissionWithToolInputDetails(permission, {
      method: "GET",
      url: "https://raw.githubusercontent.com/de4dot/de4dot/master/README.md",
    });

    expect(merged?.metadata).toEqual({
      method: "GET",
      url: "https://raw.githubusercontent.com/de4dot/de4dot/master/README.md",
    });
    expect(permissionDetailRows(merged!.metadata).map((row) => [row.label, row.value])).toEqual([
      ["URL", "https://raw.githubusercontent.com/de4dot/de4dot/master/README.md"],
    ]);
  });

  test("renders the merged arguments as raw details", () => {
    const permission = permissionWithToolInputDetails(
      pendingPermission({ permission: "calibress_curl", metadata: {} }),
      { method: "GET", url: "https://raw.githubusercontent.com/de4dot/de4dot/master/README.md" },
    );
    const html = renderToStaticMarkup(
      React.createElement(PermissionApprovalPanel, {
        permission: permission!,
        respondPermission: () => {},
      }),
    );

    const document = parseDocument(html);
    const pre = DomUtils.findAll((element) => element.name === "pre", document.children)[0];
    expect(DomUtils.textContent(pre)).toContain('"method": "GET"');
    expect(DomUtils.textContent(pre)).toContain('"url": "https://raw.githubusercontent.com/de4dot/de4dot/master/README.md"');
  });

  test("engine-provided details win and are not replaced", () => {
    const permission = pendingPermission({ metadata: { command: "rm -rf dist" } });
    expect(permissionWithToolInputDetails(permission, { command: "echo other" })).toBe(permission);
  });

  test("engine metadata keys win over conflicting argument keys", () => {
    const permission = pendingPermission({ permission: "custom_tool", metadata: { action: "execute" } });
    expect(permissionWithToolInputDetails(permission, { action: "spoofed", url: "https://example.com" })?.metadata)
      .toEqual({ action: "execute", url: "https://example.com" });
  });

  test("no-ops without arguments, without a permission, or with empty arguments", () => {
    const permission = pendingPermission({ metadata: {} });
    expect(permissionWithToolInputDetails(permission, null)).toBe(permission);
    expect(permissionWithToolInputDetails(permission, {})).toBe(permission);
    expect(permissionWithToolInputDetails(null, { url: "https://example.com" })).toBeNull();
  });
});
