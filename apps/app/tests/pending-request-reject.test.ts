import { describe, expect, test } from "bun:test";

import type { Client, PendingPermission, PendingQuestion } from "../src/app/types";
import { rejectPendingRequests } from "../src/app/lib/pending-request-reject";

type Call = { kind: string; args: Record<string, unknown> };

function recordingClient() {
  const calls: Call[] = [];
  const client = {
    v2: {
      session: {
        permission: {
          reply: async (args: Record<string, unknown>) => {
            calls.push({ kind: "permission.reply.v2", args });
            return { data: true };
          },
        },
      },
    },
    permission: {
      reply: async (args: Record<string, unknown>) => {
        calls.push({ kind: "permission.reply.v1", args });
        return { data: true };
      },
    },
    question: {
      reject: async (args: Record<string, unknown>) => {
        calls.push({ kind: "question.reject", args });
        return { data: true };
      },
    },
  } as unknown as Client;
  return { client, calls };
}

function permission(id: string, protocol: "legacy" | "v2"): PendingPermission {
  return { id, protocol, sessionID: "ses_1", permission: "edit", patterns: ["*"] } as PendingPermission;
}

function question(id: string): PendingQuestion {
  return { id, sessionID: "ses_1", questions: [] } as PendingQuestion;
}

describe("rejectPendingRequests", () => {
  test("rejects v2 permissions via the session-scoped v2 endpoint", async () => {
    const { client, calls } = recordingClient();
    await rejectPendingRequests(client, {
      sessionId: "ses_1",
      workspaceRoot: "/ws",
      permissions: [permission("p1", "v2")],
      questions: [],
    });
    expect(calls).toEqual([
      { kind: "permission.reply.v2", args: { sessionID: "ses_1", requestID: "p1", reply: "reject" } },
    ]);
  });

  test("rejects legacy permissions with the directory-scoped v1 endpoint", async () => {
    const { client, calls } = recordingClient();
    await rejectPendingRequests(client, {
      sessionId: "ses_1",
      workspaceRoot: "/ws",
      permissions: [permission("p1", "legacy")],
      questions: [],
    });
    expect(calls).toEqual([
      { kind: "permission.reply.v1", args: { requestID: "p1", reply: "reject", directory: "/ws" } },
    ]);
  });

  test("rejects pending questions and tolerates per-request failures", async () => {
    const { client, calls } = recordingClient();
    const failingQuestion = {
      ...question("q1"),
    };
    const clientWithFailure = {
      ...client,
      question: {
        reject: async (args: Record<string, unknown>) => {
          calls.push({ kind: "question.reject", args });
          if (args.requestID === "q1") throw new Error("already gone");
          return { data: true };
        },
      },
    } as unknown as Client;
    await rejectPendingRequests(clientWithFailure, {
      sessionId: "ses_1",
      workspaceRoot: "/ws",
      permissions: [permission("p1", "legacy")],
      questions: [failingQuestion, question("q2")],
    });
    expect(calls).toEqual([
      { kind: "permission.reply.v1", args: { requestID: "p1", reply: "reject", directory: "/ws" } },
      { kind: "question.reject", args: { requestID: "q1", directory: "/ws" } },
      { kind: "question.reject", args: { requestID: "q2", directory: "/ws" } },
    ]);
  });
});
