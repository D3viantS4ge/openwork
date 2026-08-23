import type { Client, PendingPermission, PendingQuestion } from "@/app/types";

/**
 * Reject pending permission and question requests engine-side. Used after a
 * run is stopped: those requests are never answered, and dismissing only the
 * local popup caches would leave them in the engine's pending registry, so
 * they reappear on the next reload when the app re-reads permission.list() /
 * question.list(). Replying "reject" (permissions) and rejecting (questions)
 * drains the registry, keeping the client and engine in agreement.
 */
export async function rejectPendingRequests(
  client: Client,
  input: {
    sessionId: string;
    workspaceRoot: string;
    permissions: PendingPermission[];
    questions: PendingQuestion[];
  },
): Promise<void> {
  const { sessionId, workspaceRoot, permissions, questions } = input;
  const directory = workspaceRoot.trim() || undefined;
  await Promise.allSettled([
    ...permissions.map((permission) =>
      permission.protocol === "v2"
        ? client.v2.session.permission.reply({ sessionID: sessionId, requestID: permission.id, reply: "reject" })
        : client.permission.reply({ requestID: permission.id, reply: "reject", directory }),
    ),
    ...questions.map((question) => client.question.reject({ requestID: question.id, directory })),
  ]);
}
