import type { UIMessage } from "ai";

import type { OpenworkSessionSnapshot } from "../../../../app/lib/openwork-server";
import { mergeSnapshotAndLiveMessages } from "../sync/message-merge";
import { applyRevertCursor } from "../sync/transcript-reconcile";
import { snapshotToUIMessages } from "../sync/usechat-adapter";

export function resolveRenderedSessionSnapshot(input: {
  sessionId: string;
  currentSnapshot: OpenworkSessionSnapshot | null | undefined;
  cachedRendered: { sessionId: string; snapshot: OpenworkSessionSnapshot } | null | undefined;
}) {
  if (input.currentSnapshot?.session.id === input.sessionId) {
    return input.currentSnapshot;
  }
  if (
    input.cachedRendered?.sessionId === input.sessionId &&
    input.cachedRendered.snapshot.session.id === input.sessionId
  ) {
    return input.cachedRendered.snapshot;
  }
  return null;
}

/**
 * Resolve the snapshot's revert cursor to an "effective" cursor for UI chrome
 * (the restore banner): a cursor is only shown while the revert is pending.
 * Once the live cache holds a message the snapshot doesn't have (the
 * replacement prompt and its streaming output, sent after the revert), the
 * revert has been acted on — the banner must not surface even if a snapshot
 * refetch re-stamps a stale cursor.
 *
 * This is separate from transcript derivation: the raw cursor must still hide
 * reverted snapshot messages mid-run (see deriveRenderedSessionMessages).
 */
export function resolveEffectiveRevertState(input: {
  snapshot: OpenworkSessionSnapshot | null | undefined;
  liveMessages: UIMessage[];
}): { revertMessageId: string | null; hiddenCount: number } {
  const snapshot = input.snapshot;
  const revertMessageId = snapshot?.session.revert?.messageID ?? null;
  if (!revertMessageId || !snapshot) return { revertMessageId: null, hiddenCount: 0 };

  const snapshotIds = new Set(snapshot.messages.map((message) => message.info.id));
  const hasLiveOnlyMessages = input.liveMessages.some((message) => !snapshotIds.has(message.id));
  if (hasLiveOnlyMessages) return { revertMessageId: null, hiddenCount: 0 };

  const cursorIndex = snapshot.messages.findIndex((message) => message.info.id === revertMessageId);
  const hiddenCount = cursorIndex < 0 ? 0 : snapshot.messages.length - cursorIndex;
  return { revertMessageId, hiddenCount };
}

export function deriveRenderedSessionMessages(input: {
  transcriptState: UIMessage[] | null | undefined;
  snapshot: OpenworkSessionSnapshot | null | undefined;
}) {
  // Use the RAW snapshot cursor here (not the effective-revert state, which
  // suppresses the restore banner): the cursor must keep hiding reverted
  // snapshot messages at/after it even while the replacement run streams —
  // the stale snapshot still carries them and they must not resurface.
  const revertMessageId = input.snapshot?.session.revert?.messageID ?? null;
  const liveMessages = input.transcriptState ?? [];

  const snapshotMessages = input.snapshot && input.snapshot.messages.length > 0
    ? snapshotToUIMessages(input.snapshot)
    : [];

  // Render the server snapshot as the history floor and layer live stream
  // updates on top. During prompt submission the live cache can briefly contain
  // only the new turn; it must not replace the older persisted transcript.
  //
  // Apply the revert cursor to the snapshot floor BEFORE merging live
  // messages: the cursor hides reverted server messages (snapshot messages at
  // and after it), never live-only messages — the replacement prompt and its
  // streaming output are post-revert content and must survive the cursor even
  // when a stale snapshot refetch re-stamps it mid-run.
  const snapshotFloor = applyRevertCursor(snapshotMessages, revertMessageId);

  const messages = snapshotFloor.length > 0
    ? mergeSnapshotAndLiveMessages(snapshotFloor, liveMessages, { appendLiveOnlyMessages: true })
    : liveMessages;

  return messages;
}
