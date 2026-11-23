import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import { restorePromptFromMessageParts } from "../src/react-app/domains/session/sync/message-prompt-restore";

const IMAGE_URL = "data:image/png;base64,iVBORw0KGgo=";
const NOTES_URL = "file:///workspaces/Worker%20Root/.opencode/openwork/inbox/chat-attachments/ses_1/nonce-a-notes.txt";
const ARCHIVE_URL = "file:///workspaces/Worker%20Root/.opencode/openwork/inbox/chat-attachments/ses_1/nonce-b-archive.zip";

function messageParts(): UIMessage["parts"] {
  return [
    { type: "text", text: "Summarize " },
    { type: "file", mediaType: "image/png", filename: "shot.png", url: IMAGE_URL },
    { type: "text", text: " and " },
    { type: "file", mediaType: "text/plain", filename: "notes.txt", url: NOTES_URL },
    { type: "file", mediaType: "application/zip", filename: "archive.zip", url: ARCHIVE_URL },
    { type: "file", mediaType: "text/plain", filename: "README.md", url: "file:///workspaces/Worker%20Root/README.md" },
    { type: "source-document", sourceId: "source-1", mediaType: "text/markdown", title: "README.md" },
  ];
}

describe("restorePromptFromMessageParts", () => {
  test("restores inline attachment tokens and skips non-attachment file parts", () => {
    const restored = restorePromptFromMessageParts(messageParts());

    expect([...restored.text.matchAll(/\[attachment [^\]]+\]/g)]).toHaveLength(3);
    expect(restored.text.startsWith("Summarize [attachment ")).toBe(true);
    expect(restored.text).toContain(" and [attachment ");
    expect(restored.attachments.map((attachment) => attachment.name)).toEqual([
      "shot.png",
      "notes.txt",
      "archive.zip",
    ]);
  });

  test("keeps the original file part and a displayable image preview", () => {
    const restored = restorePromptFromMessageParts(messageParts());
    const image = restored.attachments[0];
    const notes = restored.attachments[1];

    expect(image?.kind).toBe("image");
    expect(image?.previewUrl).toBe(IMAGE_URL);
    expect(image?.restoredFilePart).toEqual({
      type: "file",
      url: IMAGE_URL,
      filename: "shot.png",
      mime: "image/png",
    });
    expect(notes?.kind).toBe("file");
    expect(notes?.mimeType).toBe("text/plain");
    expect(notes?.restoredFilePart?.url).toBe(NOTES_URL);
    expect(notes?.restoredFilePart?.mime).toBe("text/plain");
  });

  test("infers the original mime for text-like attachments while keeping the sent mime", () => {
    const restored = restorePromptFromMessageParts([
      {
        type: "file",
        mediaType: "text/plain",
        filename: "data.csv",
        url: "file:///workspaces/Worker%20Root/.opencode/openwork/inbox/chat-attachments/ses_1/nonce-c-data.csv",
      },
    ]);

    expect(restored.attachments[0]?.mimeType).toBe("text/csv");
    expect(restored.attachments[0]?.restoredFilePart?.mime).toBe("text/plain");
  });
});
