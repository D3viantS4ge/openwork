import {
  $createRangeSelection,
  $isElementNode,
  $isTextNode,
  $setSelection,
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
  const selection = $createRangeSelection();
  const offset = node.getIndexWithinParent() + 1;
  selection.anchor.set(parent.getKey(), offset, "element");
  selection.focus.set(parent.getKey(), offset, "element");
  $setSelection(selection);
}

export function setSelectionBeforeNode(node: TextNode) {
  const parent = node.getParent();
  if (!parent || !$isElementNode(parent)) return;
  const selection = $createRangeSelection();
  const offset = node.getIndexWithinParent();
  selection.anchor.set(parent.getKey(), offset, "element");
  selection.focus.set(parent.getKey(), offset, "element");
  $setSelection(selection);
}
