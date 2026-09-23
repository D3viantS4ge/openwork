export type ShellModeKeyEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey">;

/**
 * Whether a Backspace in `!` shell mode should exit back to prompt mode.
 *
 * The `!` is a virtual prefix — it is never inserted as a character, so it is
 * not part of the command text. Backspace on an empty command, or with the
 * caret at the very start of the composer (i.e. sitting "on" the `!`), deletes
 * that prefix and leaves shell mode. Modifier chords keep their own meaning
 * (word/line deletion) and an active selection is deleted by the browser, so
 * neither exits shell mode.
 */
export function shouldExitShellModeOnBackspace(
  event: ShellModeKeyEvent,
  context: { empty: boolean; caretAtEditorStart: boolean },
): boolean {
  if (event.key !== "Backspace") return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return context.empty || context.caretAtEditorStart;
}

/**
 * True when the collapsed caret sits at the very start of the editor's content.
 *
 * The DOM anchor can be the editor element itself or a descendant text node
 * (PlainTextPlugin wraps text in a paragraph), so the check walks the anchor's
 * ancestors: the caret must sit at offset 0 and every ancestor up to the editor
 * must be its parent's first child. A non-collapsed selection (text the user
 * selected to delete) never counts as "at the start".
 */
export function isCaretAtEditorStart(editorRoot: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const anchor = range.startContainer;
  // Caret anchored on the editor element itself: only position 0 is the start.
  if (anchor === editorRoot) return range.startOffset === 0;
  if (range.startOffset !== 0) return false;
  let node: Node | null = anchor;
  while (node && node !== editorRoot) {
    const parent: Node | null = node.parentNode;
    if (!parent || parent.firstChild !== node) return false;
    node = parent;
  }
  return node === editorRoot;
}
