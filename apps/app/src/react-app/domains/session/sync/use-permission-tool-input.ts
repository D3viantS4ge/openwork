// Review details for tool permissions. The engine asks custom MCP tools with
// empty metadata, so the prompt's only reviewable detail is the tool call's
// own arguments — read from the transcript's tool part (already streamed
// before the ask) or, when that session's transcript is not cached (child
// sessions, cache eviction), fetched from the engine by message id.
import { useEffect, useMemo } from "react";
import type { Part } from "@opencode-ai/sdk/v2/client";
import type { UIMessage } from "ai";

import type { Client, PendingPermission } from "@/app/types";
import { useQueryCacheState } from "@/react-app/infra/query-cache-state";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { permissionDetailRows } from "../chat/permission-details";
import { transcriptKey } from "./session-sync";

const EMPTY_MESSAGES: UIMessage[] = [];
const EMPTY_PARTS: Part[] = [];

export type PermissionToolRef = { messageID: string; callID: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tool call arguments from the rendered transcript for the permission's tool call. */
export function toolInputFromUIMessages(
  messages: readonly UIMessage[],
  tool: PermissionToolRef,
): Record<string, unknown> | null {
  const message = messages.find((candidate) => candidate.id === tool.messageID);
  if (!message) return null;
  for (const part of message.parts) {
    if (part.type !== "dynamic-tool" || part.toolCallId !== tool.callID) continue;
    return isRecord(part.input) ? part.input : null;
  }
  return null;
}

/** Tool call arguments from raw engine message parts (both engine protocols). */
export function toolInputFromParts(parts: readonly Part[], callID: string): Record<string, unknown> | null {
  for (const part of parts) {
    if (part.type !== "tool" || part.callID !== callID) continue;
    return part.state.input;
  }
  return null;
}

/** Cache-first selection of the tool arguments used to enrich a permission. */
export function selectPermissionToolInput(options: {
  engineHasDetails: boolean;
  tool: PermissionToolRef | null;
  messages: readonly UIMessage[];
  parts: readonly Part[];
}): Record<string, unknown> | null {
  if (options.engineHasDetails || !options.tool) return null;
  return toolInputFromUIMessages(options.messages, options.tool)
    ?? toolInputFromParts(options.parts, options.tool.callID);
}

export function usePermissionToolInput(input: {
  client: Client | null;
  workspaceId: string;
  permission: PendingPermission | null;
}): Record<string, unknown> | null {
  const tool = input.permission?.tool ?? null;
  const sessionId = input.permission?.sessionID ?? "";
  // Engine-provided review rows always win; skip the lookup entirely when they
  // exist so built-in tools are unaffected and no request is made.
  const engineHasDetails = input.permission
    ? permissionDetailRows(input.permission.metadata).length > 0
    : false;
  const messages = useQueryCacheState<UIMessage[]>(
    !engineHasDetails && tool ? transcriptKey(input.workspaceId, sessionId) : null,
    EMPTY_MESSAGES,
  );
  const cached = useMemo(
    () => selectPermissionToolInput({ engineHasDetails, tool, messages, parts: [] }),
    [engineHasDetails, messages, tool],
  );
  // When the transcript has no part (child sessions, cache eviction), fetch the
  // message once and read the result back through the cache subscription. The
  // fetch starts from an effect so no query observer is created during render.
  const fetchKey = useMemo(
    () => ["permission-tool-input", input.workspaceId, sessionId, tool?.messageID ?? "", tool?.callID ?? ""] as const,
    [input.workspaceId, sessionId, tool],
  );
  const fetchEnabled = Boolean(input.client && tool && !cached && !engineHasDetails);
  const queryClient = getReactQueryClient();
  useEffect(() => {
    if (!fetchEnabled || !input.client || !tool) return;
    const client = input.client;
    const messageID = tool.messageID;
    void queryClient.fetchQuery({
      queryKey: fetchKey,
      staleTime: Infinity,
      retry: false,
      queryFn: async (): Promise<Part[]> => {
        const result = await client.session.message({ sessionID: sessionId, messageID });
        return result.data?.parts ?? [];
      },
    }).catch(() => {
      // A failed read only means the prompt shows no extra details.
    });
  }, [fetchEnabled, fetchKey, input.client, queryClient, sessionId, tool]);
  const fetchedParts = useQueryCacheState<Part[]>(fetchEnabled ? fetchKey : null, EMPTY_PARTS);
  return useMemo(
    () => selectPermissionToolInput({ engineHasDetails, tool, messages, parts: fetchedParts }),
    [engineHasDetails, messages, fetchedParts, tool],
  );
}
