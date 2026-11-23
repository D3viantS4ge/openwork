import type { FileUIPart, UIMessage } from "ai";

import type { ComposerAttachment } from "@/app/types";
import { resolveAttachmentMime } from "./attachment-file-part";
import { filePathFromFileUrl } from "./prompt-file-parts";

const CHAT_ATTACHMENT_INBOX_SEGMENT = "/.opencode/openwork/inbox/chat-attachments/";
const GENERIC_BINARY_MIME = "application/octet-stream";

export type RestoredMessagePrompt = {
  text: string;
  attachments: ComposerAttachment[];
};

function createAttachmentId() {
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function dataUrlMime(url: string) {
  return /^data:([^;,]+)/i.exec(url)?.[1]?.trim() ?? "";
}

function filenameFromUrl(url: string) {
  const path = filePathFromFileUrl(url);
  if (!path) return "";
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function isRestorableAttachment(part: UIMessage["parts"][number]): part is FileUIPart {
  if (part.type !== "file" || !part.url) return false;
  if (part.url.startsWith("data:")) return true;
  if (/^https?:\/\//i.test(part.url)) return true;
  const path = filePathFromFileUrl(part.url);
  return Boolean(path && path.replace(/\\/g, "/").includes(CHAT_ATTACHMENT_INBOX_SEGMENT));
}

function restoredAttachment(part: FileUIPart): ComposerAttachment {
  const filename = part.filename?.trim() || filenameFromUrl(part.url) || "attachment";
  const declaredMime = part.mediaType?.trim() || dataUrlMime(part.url) || "";
  const inferredMime = resolveAttachmentMime({ name: filename, type: "" });
  const mimeType = declaredMime === "text/plain" && inferredMime !== GENERIC_BINARY_MIME
    ? inferredMime
    : declaredMime || inferredMime;
  const filePartMime = declaredMime || mimeType;
  const kind = mimeType.startsWith("image/") ? "image" : "file";
  const file = new File([], filename, { type: mimeType });
  return {
    id: createAttachmentId(),
    name: filename,
    mimeType,
    size: 0,
    kind,
    file,
    ...(kind === "image" ? { previewUrl: part.url } : {}),
    restoredFilePart: {
      type: "file",
      url: part.url,
      filename,
      mime: filePartMime,
    },
  };
}

export function restorePromptFromMessageParts(
  parts: readonly UIMessage["parts"][number][],
): RestoredMessagePrompt {
  const segments: string[] = [];
  const attachments: ComposerAttachment[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      segments.push(part.text);
      continue;
    }
    if (!isRestorableAttachment(part)) continue;
    const attachment = restoredAttachment(part);
    attachments.push(attachment);
    segments.push(`[attachment ${attachment.id}]`);
  }
  return { text: segments.join("").trim(), attachments };
}
