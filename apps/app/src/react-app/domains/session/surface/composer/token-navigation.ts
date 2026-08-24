import {
  $createRangeSelection,
  $isElementNode,
  $isLineBreakNode,
  $isTextNode,
  $setSelection,
  type ElementNode,
  type LexicalNode,
  type RangeSelection,
  type TextNode,
} from "lexical";

/**
 * True when a node is a composer inline "chip" node (paste pill, mention,
 * slash command, skill, attachment). All five extend TextNode with
 * isToken()/isTextEntity() and render a contenteditable=false pill, so the
 * token flag is the reliable discriminator — the concrete classes live in
 * the editor module and are not importable from a pure test unit.
 */
export function isComposerInlineTokenNode(node: LexicalNode | null | undefined): node is TextNode {
  return $isTextNode(node) && node.isToken();
}

/**
 * True when a node is the zero-width caret anchor that sits next to a pill so
 * Chrome can paint a caret at the pill's edge. It is a plain (non-token)
 * text node holding exactly one ZWSP; navigation and deletion treat it as
 * invisible. Duck-typed on the node type name so this pure module does not
 * import the editor.
 */
export function isComposerCaretAnchorNode(node: LexicalNode | null | undefined): boolean {
  return $isTextNode(node) && node.getType() === "composer-caret-anchor";
}

/**
 * Resolve the token chip the collapsed caret is inside of or immediately
 * adjacent to (previous or next sibling at the anchor's element offset), or
 * null when the caret sits in plain text away from any chip. Used by the
 * navigation guards to snap the caret to a chip boundary instead of letting
 * the browser drop it inside the chip's span.
 */
export function adjacentTokenForSelection(selection: RangeSelection): TextNode | null {
  if (!selection.isCollapsed()) return null;
  const anchorNode = selection.anchor.getNode();
  if (isComposerInlineTokenNode(anchorNode)) return anchorNode;
  if (isComposerCaretAnchorNode(anchorNode)) {
    // The caret is inside a ZWSP anchor next to a pill: treat it as being at
    // the pill boundary itself.
    const next = anchorNode.getNextSibling();
    const previous = anchorNode.getPreviousSibling();
    if (isComposerInlineTokenNode(next)) return next;
    if (isComposerInlineTokenNode(previous)) return previous;
    return null;
  }
  if (!$isElementNode(anchorNode)) return null;
  const at = anchorNode.getChildAtIndex(selection.anchor.offset);
  const before = anchorNode.getChildAtIndex(selection.anchor.offset - 1);
  if (isComposerInlineTokenNode(at)) return at;
  if (isComposerInlineTokenNode(before)) return before;
  return null;
}

export function setSelectionAfterNode(node: TextNode) {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return;
  // Anchor the caret inside the next editable text node when there is one:
  // Chrome renders a caret at a bare element boundary preceding a
  // contenteditable=false inline INSIDE that inline's content (yellow caret
  // inside the pill). A text anchor at the next sibling's start paints a
  // normal caret just outside the pill.
  const next = node.getNextSibling();
  if ($isTextNode(next) && !next.isToken() && next.getTextContentSize() > 0) {
    const selection = $createRangeSelection();
    selection.anchor.set(next.getKey(), 0, "text");
    selection.focus.set(next.getKey(), 0, "text");
    $setSelection(selection);
    return;
  }
  const selection = $createRangeSelection();
  const offset = node.getIndexWithinParent() + 1;
  selection.anchor.set(parent.getKey(), offset, "element");
  selection.focus.set(parent.getKey(), offset, "element");
  $setSelection(selection);
}

export function setSelectionBeforeNode(node: TextNode) {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return;
  // Anchor the caret inside the previous editable text node when there is
  // one: a bare element boundary before the pill renders the caret inside
  // the pill's padded content in Chrome.
  const previous = node.getPreviousSibling();
  if ($isTextNode(previous) && !previous.isToken() && previous.getTextContentSize() > 0) {
    const selection = $createRangeSelection();
    const offset = previous.getTextContentSize();
    selection.anchor.set(previous.getKey(), offset, "text");
    selection.focus.set(previous.getKey(), offset, "text");
    $setSelection(selection);
    return;
  }
  const selection = $createRangeSelection();
  const offset = node.getIndexWithinParent();
  selection.anchor.set(parent.getKey(), offset, "element");
  selection.focus.set(parent.getKey(), offset, "element");
  $setSelection(selection);
}

/**
 * Find the nearest token chip strictly before the caret within the same
 * paragraph. Used by Ctrl+Arrow word navigation so the pill acts as a word
 * boundary: from "foo[pill]bar|", Ctrl+Left should stop before the pill
 * ("foo|[pill]bar") instead of jumping past it to the line start.
 */
export function tokenBeforeCaretInParagraph(selection: RangeSelection): TextNode | null {
  if (!selection.isCollapsed()) return null;
  const paragraph = caretParagraph(selection);
  if (!paragraph) return null;
  const anchorOffset = caretParagraphOffset(selection);
  if (anchorOffset === null) return null;
  for (let index = anchorOffset - 1; index >= 0; index -= 1) {
    const child = paragraph.getChildAtIndex(index);
    if (isComposerInlineTokenNode(child)) return child;
  }
  return null;
}

/**
 * Find the nearest token chip strictly after the caret within the same
 * paragraph. Used by Ctrl+Arrow word navigation so the pill acts as a word
 * boundary: from "foo|[pill]bar", Ctrl+Right should stop after the pill
 * ("foo[pill]|bar") instead of jumping past it to the line end.
 */
export function tokenAfterCaretInParagraph(selection: RangeSelection): TextNode | null {
  if (!selection.isCollapsed()) return null;
  const paragraph = caretParagraph(selection);
  if (!paragraph) return null;
  const anchorOffset = caretParagraphOffset(selection);
  if (anchorOffset === null) return null;
  const size = paragraph.getChildrenSize();
  for (let index = anchorOffset; index < size; index += 1) {
    const child = paragraph.getChildAtIndex(index);
    if (isComposerInlineTokenNode(child)) return child;
  }
  return null;
}

/** The top-level paragraph (or other block element) that holds the caret. */
function caretParagraph(selection: RangeSelection): ElementNode | null {
  const anchorNode = selection.anchor.getNode();
  let node: LexicalNode | null = anchorNode;
  while (node) {
    if ($isElementNode(node) && node.getParent() !== null && !node.isInline()) return node;
    node = node.getParent();
  }
  return null;
}

/**
 * Paragraph-relative caret offset: the element offset equivalent of the
 * anchor, so callers can compare the caret position against a child index
 * regardless of whether the anchor is element- or text-typed. Returns null
 * when the selection is not collapsed.
 *
 * A caret anchor node next to a pill is invisible: the caret is reported as
 * sitting at the pill boundary on the anchor's side (one index past the pill
 * when the anchor follows it, the pill's own index when it precedes it), so
 * word navigation and the edge checks never see the extra ZWSP character.
 */
export function caretParagraphOffset(selection: RangeSelection): number | null {
  if (!selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  if (anchor.type === "element") return anchor.offset;
  const node = anchor.getNode();
  if (!$isTextNode(node) || !node.getParent()) return null;
  if (isComposerCaretAnchorNode(node)) {
    const previous = node.getPreviousSibling();
    const next = node.getNextSibling();
    if (isComposerInlineTokenNode(previous)) return previous.getIndexWithinParent() + 1;
    if (isComposerInlineTokenNode(next)) return next.getIndexWithinParent();
    // Stray anchor with no pill neighbor: treat as its own (invisible) slot.
    return node.getIndexWithinParent() + (anchor.offset > 0 ? 1 : 0);
  }
  return node.getIndexWithinParent() + (anchor.offset > 0 ? 1 : 0);
}

/**
 * True when the collapsed caret sits exactly at the LEFT edge of a token chip
 * (just before it): an element anchor at the token's index, or a text anchor
 * at the end of the token's previous sibling. A caret anchored in a caret
 * anchor that precedes the token counts as the left edge.
 */
export function caretAtTokenLeftEdge(selection: RangeSelection, token: TextNode): boolean {
  if (!selection.isCollapsed()) return false;
  const anchor = selection.anchor;
  if (anchor.type === "element") return anchor.offset === token.getIndexWithinParent();
  const node = anchor.getNode();
  if (!$isTextNode(node)) return false;
  if (isComposerCaretAnchorNode(node)) return node.getNextSibling() === token;
  return node.getNextSibling() === token && anchor.offset >= node.getTextContentSize();
}

/**
 * True when the collapsed caret sits exactly at the RIGHT edge of a token
 * chip (just after it): an element anchor at the token's index + 1, or a text
 * anchor at the start of the token's next sibling. A caret anchored in a
 * caret anchor that follows the token counts as the right edge.
 */
export function caretAtTokenRightEdge(selection: RangeSelection, token: TextNode): boolean {
  if (!selection.isCollapsed()) return false;
  const anchor = selection.anchor;
  if (anchor.type === "element") return anchor.offset === token.getIndexWithinParent() + 1;
  const node = anchor.getNode();
  if (!$isTextNode(node)) return false;
  if (isComposerCaretAnchorNode(node)) return node.getPreviousSibling() === token;
  return node.getPreviousSibling() === token && anchor.offset === 0;
}

/**
 * True when the collapsed caret sits at the very end of its paragraph and the
 * next paragraph starts with a token chip. Used by Right-arrow navigation so
 * crossing a line boundary lands before a leading pill (start of the line)
 * instead of after it.
 */
export function nextParagraphStartsWithToken(selection: RangeSelection): TextNode | null {
  if (!selection.isCollapsed()) return null;
  const paragraph = caretParagraph(selection);
  if (!paragraph || !$isElementNode(paragraph)) return null;
  const anchor = selection.anchor;
  const anchorAtEnd = anchor.type === "element"
    ? anchor.offset >= paragraph.getChildrenSize()
    : anchor.getNode().getParent() === paragraph && anchor.offset >= anchor.getNode().getTextContentSize();
  if (!anchorAtEnd) return null;
  const next = paragraph.getNextSibling();
  if (!$isElementNode(next)) return null;
  const first = next.getChildAtIndex(0);
  if (isComposerInlineTokenNode(first)) return first;
  return null;
}

/**
 * Mirror of nextParagraphStartsWithToken: true when the caret sits at the
 * very start of its paragraph and the previous paragraph ends with a token
 * chip. Used by Left-arrow navigation so crossing a line boundary lands after
 * a trailing pill (end of the line) instead of before it.
 */
export function previousParagraphEndsWithToken(selection: RangeSelection): TextNode | null {
  if (!selection.isCollapsed()) return null;
  const paragraph = caretParagraph(selection);
  if (!paragraph || !$isElementNode(paragraph)) return null;
  const anchor = selection.anchor;
  const anchorAtStart = anchor.type === "element"
    ? anchor.offset <= 0
    : anchor.getNode().getParent() === paragraph && anchor.offset <= 0;
  if (!anchorAtStart) return null;
  const previous = paragraph.getPreviousSibling();
  if (!$isElementNode(previous)) return null;
  const last = previous.getChildAtIndex(previous.getChildrenSize() - 1);
  if (isComposerInlineTokenNode(last)) return last;
  return null;
}

/**
 * The composer renders soft line breaks as LineBreakNode children inside a
 * single paragraph. When the caret sits at the end of a text segment that is
 * immediately followed by a line break and then a token chip (i.e. the pill
 * starts the next visual line), Right-arrow must land before that pill — the
 * start of the next line — instead of jumping past it to the line end.
 */
export function tokenAfterLineBreak(selection: RangeSelection): TextNode | null {
  if (!selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  if (anchor.type !== "text") return null;
  const anchorNode = anchor.getNode();
  const parent = anchorNode.getParent();
  if (!parent || !$isElementNode(parent)) return null;
  if (anchor.offset < anchorNode.getTextContentSize()) return null;
  const next = anchorNode.getNextSibling();
  if (!next || !$isLineBreakNode(next)) return null;
  const afterBreak = next.getNextSibling();
  if (isComposerInlineTokenNode(afterBreak)) return afterBreak;
  return null;
}

/**
 * Mirror of tokenAfterLineBreak: when the caret sits at the start of a text
 * segment that is immediately preceded by a token chip and then a line break
 * (i.e. the pill ends the previous visual line), Left-arrow must land after
 * that pill — the end of the previous line — instead of jumping before it.
 */
export function tokenBeforeLineBreak(selection: RangeSelection): TextNode | null {
  if (!selection.isCollapsed()) return null;
  const anchor = selection.anchor;
  if (anchor.type !== "text") return null;
  const anchorNode = anchor.getNode();
  const parent = anchorNode.getParent();
  if (!parent || !$isElementNode(parent)) return null;
  if (anchor.offset > 0) return null;
  const previous = anchorNode.getPreviousSibling();
  if (!previous || !$isLineBreakNode(previous)) return null;
  const beforeBreak = previous.getPreviousSibling();
  if (isComposerInlineTokenNode(beforeBreak)) return beforeBreak;
  return null;
}
