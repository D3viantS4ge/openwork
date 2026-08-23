export type ShellMetadataParseResult = {
  /** Output with the shell_metadata blocks removed (whitespace collapsed). */
  body: string;
  /** Lines from inside the shell_metadata blocks, e.g. "User aborted the command". */
  notes: string[];
};

/**
 * The engine appends machine-readable notes to shell output as
 * `<shell_metadata>…</shell_metadata>` (abort, timeout). Rendering them raw
 * leaks the literal tags and the note text into the output pre; the app
 * should strip the blocks and surface the notes as styled messages instead.
 */
export function parseShellMetadata(output: string): ShellMetadataParseResult {
  const notes: string[] = [];
  const body = output.replace(/<shell_metadata>([\s\S]*?)<\/shell_metadata>/g, (_match, inner: string) => {
    for (const line of inner.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) notes.push(trimmed);
    }
    return "";
  });
  return { body: body.replace(/\n{3,}/g, "\n\n").trim(), notes };
}
