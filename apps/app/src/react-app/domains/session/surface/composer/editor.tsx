/** @jsxImportSource react */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type ForwardedRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer.js";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin.js";
import { ContentEditable } from "@lexical/react/LexicalContentEditable.js";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary.js";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin.js";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin.js";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext.js";
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createRangeSelection,
  $createRangeSelectionFromDom,
  $createParagraphNode,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $nodesOfType,
  $setSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  getDOMSelection,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  MOVE_TO_END,
  MOVE_TO_START,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type SerializedTextNode,
  type Spread,
  TextNode,
  type EditorConfig,
  type NodeKey,
} from "lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer.js";
import { decodeComposerMentionValue, encodeComposerMentionValue, type ComposerMentionKind } from "./mention-encoding";
import { parseConnectSkillToken } from "./connect-skill-token";
import { createPastedTextChip, shouldCollapsePastedText, splitPastedText } from "./pasted-text";
import { insertPastedText } from "./pasted-text-insertion";
import {
  adjacentTokenForSelection,
  caretAtTokenLeftEdge,
  caretAtTokenRightEdge,
  caretParagraphOffset,
  nextParagraphStartsWithToken,
  previousParagraphEndsWithToken,
  setSelectionAfterNode,
  setSelectionBeforeNode,
  tokenAfterCaretInParagraph,
  tokenAfterLineBreak,
  tokenBeforeCaretInParagraph,
  tokenBeforeLineBreak,
} from "./token-navigation";

type PastedTextToken = { id: string; label: string; lines: number; text: string };

// Invisible anchor text node inserted next to a pill so Chrome can paint a
// caret at the pill's edge even when there is no real text neighbor (blank
// box, pill at line start, pill after a line break). Stripped from the
// serialized draft so it never reaches the stored text or the sent message.
const ZERO_WIDTH_SPACE = "\u200b";

export type ComposerAttachmentToken = {
  id: string;
  name: string;
  kind: "image" | "file";
  previewUrl?: string;
};

type EditorProps = {
  value: string;
  mentions: Record<string, ComposerMentionKind>;
  pastedText?: PastedTextToken[];
  attachments?: ComposerAttachmentToken[];
  disabled: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: (options: { queue: boolean }) => void | Promise<void>;
  onExpandPastedText?: (label: string) => void;
  onRemoveAttachment?: (id: string) => void;
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  onPasteText?: (text: string, placeholder: string, chip: PastedTextToken, serializedAfterInsert?: string) => void;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
};

export type LexicalPromptEditorHandle = {
  insertSkillAtSelection: (skillName: string, skillToken?: string) => void;
};

type SerializedComposerMentionNode = Spread<
  {
    mentionValue: string;
    mentionKind: ComposerMentionKind;
    type: "composer-mention";
    version: 1;
  },
  SerializedTextNode
>;

type SerializedComposerSlashCommandNode = Spread<
  {
    commandName: string;
    type: "composer-slash-command";
    version: 1;
  },
  SerializedTextNode
>;

type SerializedComposerSkillNode = Spread<
  {
    skillName: string;
    skillToken?: string;
    type: "composer-skill";
    version: 1;
  },
  SerializedTextNode
>;

const MENTION_PILL_CLASS: Record<ComposerMentionKind, string> = {
  file: "inline-flex items-center rounded-full border border-gray-6 bg-gray-3 px-2.5 py-1 text-xs font-medium text-gray-11",
  agent: "inline-flex items-center rounded-full border border-sky-6/35 bg-sky-3/20 px-2.5 py-1 text-xs font-medium text-sky-11",
  app: "inline-flex items-center rounded-full border border-cyan-6/35 bg-cyan-3/20 px-2.5 py-1 text-xs font-medium text-cyan-11",
};

function mentionPillText(value: string, kind: ComposerMentionKind) {
  return `@${kind === "file" ? value.split(/[\\/]/).pop() || value : value}`;
}

class ComposerMentionNode extends TextNode {
  __value: string;
  __kind: ComposerMentionKind;

  static override getType() {
    return "composer-mention";
  }

  static override clone(node: ComposerMentionNode) {
    return new ComposerMentionNode(node.__value, node.__kind, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerMentionNode) {
    return $createComposerMentionNode(serializedNode.mentionValue, serializedNode.mentionKind);
  }

  constructor(value = "", kind: ComposerMentionKind = "file", key?: NodeKey) {
    super(`@${encodeComposerMentionValue(value)}`, key);
    this.__value = value;
    this.__kind = kind;
  }

  override exportJSON(): SerializedComposerMentionNode {
    return {
      ...super.exportJSON(),
      mentionValue: this.__value,
      mentionKind: this.__kind,
      type: "composer-mention",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    dom.className = MENTION_PILL_CLASS[this.__kind];
    dom.textContent = mentionPillText(this.__value, this.__kind);
    dom.contentEditable = "false";
    dom.style.userSelect = "none";
    dom.setAttribute("spellcheck", "false");
    dom.title = `@${this.__value}`;
    return dom;
  }

  override updateDOM(prevNode: ComposerMentionNode, dom: HTMLElement) {
    if (prevNode.__value !== this.__value || prevNode.__kind !== this.__kind) {
      dom.className = MENTION_PILL_CLASS[this.__kind];
      dom.textContent = mentionPillText(this.__value, this.__kind);
      dom.title = `@${this.__value}`;
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

function $createComposerMentionNode(value: string, kind: ComposerMentionKind) {
  return $applyNodeReplacement(new ComposerMentionNode(value, kind));
}

class ComposerSlashCommandNode extends TextNode {
  __commandName: string;

  static override getType() {
    return "composer-slash-command";
  }

  static override clone(node: ComposerSlashCommandNode) {
    return new ComposerSlashCommandNode(node.__commandName, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerSlashCommandNode) {
    return $createComposerSlashCommandNode(serializedNode.commandName);
  }

  constructor(commandName = "", key?: NodeKey) {
    super(`/${commandName}`, key);
    this.__commandName = commandName;
  }

  override exportJSON(): SerializedComposerSlashCommandNode {
    return {
      ...super.exportJSON(),
      commandName: this.__commandName,
      type: "composer-slash-command",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    dom.className = "inline-flex items-center rounded-full border border-violet-6/35 bg-violet-3/20 px-2.5 py-1 text-xs font-medium text-violet-11";
    dom.textContent = `/${this.__commandName}`;
    dom.contentEditable = "false";
    dom.style.userSelect = "none";
    dom.setAttribute("spellcheck", "false");
    dom.title = `/${this.__commandName}`;
    return dom;
  }

  override updateDOM(prevNode: ComposerSlashCommandNode, dom: HTMLElement) {
    if (prevNode.__commandName !== this.__commandName) {
      dom.textContent = `/${this.__commandName}`;
      dom.title = `/${this.__commandName}`;
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

function $createComposerSlashCommandNode(commandName: string) {
  return $applyNodeReplacement(new ComposerSlashCommandNode(commandName));
}

class ComposerSkillNode extends TextNode {
  __skillName: string;
  __skillToken: string;

  static override getType() {
    return "composer-skill";
  }

  static override clone(node: ComposerSkillNode) {
    return new ComposerSkillNode(node.__skillName, node.__skillToken, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerSkillNode) {
    return $createComposerSkillNode(serializedNode.skillName, serializedNode.skillToken);
  }

  constructor(skillName = "", skillToken?: string, key?: NodeKey) {
    super(skillToken ?? `[skill ${skillName}]`, key);
    this.__skillName = skillName;
    this.__skillToken = skillToken ?? `[skill ${skillName}]`;
  }

  override exportJSON(): SerializedComposerSkillNode {
    return {
      ...super.exportJSON(),
      skillName: this.__skillName,
      skillToken: this.__skillToken,
      type: "composer-skill",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    dom.className = "inline-flex items-center rounded-full border border-violet-6/35 bg-violet-3/20 px-2.5 py-1 text-xs font-medium text-violet-11";
    dom.textContent = `/${this.__skillName}`;
    dom.contentEditable = "false";
    dom.style.userSelect = "none";
    dom.setAttribute("spellcheck", "false");
    dom.title = `Skill: ${this.__skillName}`;
    return dom;
  }

  override updateDOM(prevNode: ComposerSkillNode, dom: HTMLElement) {
    if (prevNode.__skillName !== this.__skillName) {
      dom.textContent = `/${this.__skillName}`;
      dom.title = `Skill: ${this.__skillName}`;
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

function $createComposerSkillNode(skillName: string, skillToken?: string) {
  return $applyNodeReplacement(new ComposerSkillNode(skillName, skillToken));
}

function pastedTextChipLabel(lines: number) {
  return `Pasted · ${lines} line${lines === 1 ? "" : "s"}`;
}

function createPastedTextChipDom(label: string, lines: number) {
  // The pill must be non-atomic inline content: Chrome treats inline-flex /
  // inline-block as an atomic inline box and refuses to paint a caret at the
  // paragraph boundary before it at line start (the caret is resolved into
  // the pill's own text instead of "|[pill]"). Both the outer span and the
  // styled wrapper stay display:inline so the boundary stays paintable; the
  // wrapper carries the pill styling (nowrap keeps it from wrapping).
  const dom = document.createElement("span");
  dom.contentEditable = "false";
  dom.style.userSelect = "none";
  dom.setAttribute("spellcheck", "false");
  dom.title = `Pasted text · ${label}`;

  const pill = document.createElement("span");
  pill.className = "whitespace-nowrap rounded-full border border-amber-6/35 bg-amber-3/15 px-2.5 py-1 text-xs font-medium text-amber-11 align-middle";

  const text = document.createElement("span");
  text.textContent = pastedTextChipLabel(lines);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-amber-11 underline decoration-amber-8 underline-offset-2 transition-colors hover:bg-amber-4 hover:text-amber-12";
  button.title = "Expand";
  button.setAttribute("aria-label", "Expand pasted text in composer");
  button.dataset.pastedExpandLabel = label;

  const actionText = document.createElement("span");
  actionText.textContent = "Expand";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "h-3 w-3");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m6 3 5 5-5 5");
  svg.append(path);
  button.append(actionText, svg);
  pill.append(text, button);
  dom.append(pill);
  return dom;
}

function updatePastedTextChipDom(dom: HTMLElement, label: string, lines: number) {
  const text = dom.querySelector(":scope > span > span");
  if (text) text.textContent = pastedTextChipLabel(lines);
  const button = dom.querySelector("button[data-pasted-expand-label]");
  if (button instanceof HTMLButtonElement) {
    button.title = "Expand";
    button.setAttribute("aria-label", "Expand pasted text in composer");
    button.dataset.pastedExpandLabel = label;
  }
  dom.title = `Pasted text · ${label}`;
}

type SerializedComposerPastedTextNode = Spread<
  {
    pastedLabel: string;
    pastedLines: number;
    type: "composer-pasted-text";
    version: 1;
  },
  SerializedTextNode
>;

class ComposerPastedTextNode extends TextNode {
  __pastedLabel: string;
  __pastedLines: number;

  static override getType() {
    return "composer-pasted-text";
  }

  static override clone(node: ComposerPastedTextNode) {
    return new ComposerPastedTextNode(node.__pastedLabel, node.__pastedLines, node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerPastedTextNode) {
    return $createComposerPastedTextNode(serializedNode.pastedLabel, serializedNode.pastedLines);
  }

  constructor(label = "", lines = 0, key?: NodeKey) {
    super(`[pasted text ${label}]`, key);
    this.__pastedLabel = label;
    this.__pastedLines = lines;
  }

  getPastedLabel() {
    return this.__pastedLabel;
  }

  override exportJSON(): SerializedComposerPastedTextNode {
    return {
      ...super.exportJSON(),
      pastedLabel: this.__pastedLabel,
      pastedLines: this.__pastedLines,
      type: "composer-pasted-text",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    return createPastedTextChipDom(this.__pastedLabel, this.__pastedLines);
  }

  override updateDOM(prevNode: ComposerPastedTextNode, dom: HTMLElement) {
    if (prevNode.__pastedLabel !== this.__pastedLabel || prevNode.__pastedLines !== this.__pastedLines) {
      updatePastedTextChipDom(dom, this.__pastedLabel, this.__pastedLines);
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

function $createComposerPastedTextNode(label: string, lines: number) {
  return $applyNodeReplacement(new ComposerPastedTextNode(label, lines));
}

type SerializedComposerCaretAnchorNode = Spread<
  {
    type: "composer-caret-anchor";
    version: 1;
  },
  SerializedTextNode
>;

/**
 * Invisible, zero-width caret anchor that sits next to a pill so Chrome can
 * paint the caret at the pill's edge even when there is no real text
 * neighbor. Unlike a plain ZWSP text node it is:
 *  - transparent to navigation: every caret helper skips it, so arrows cross
 *    the pill boundary in one press (no extra press "over the ZWSP"), and
 *  - undeletable: Backspace/Delete never remove it (they act on the pill or
 *    its real-text neighbors instead).
 * The DOM renders the ZWSP so Chrome has a real text position to paint a
 * caret at; the serialized draft strips it so it never reaches the stored
 * text or the sent message.
 */
class ComposerCaretAnchorNode extends TextNode {
  static override getType() {
    return "composer-caret-anchor";
  }

  static override clone(node: ComposerCaretAnchorNode) {
    return new ComposerCaretAnchorNode(node.__key);
  }

  static override importJSON(serializedNode: SerializedComposerCaretAnchorNode) {
    return $createComposerCaretAnchorNode();
  }

  constructor(key?: NodeKey) {
    super(ZERO_WIDTH_SPACE, key);
  }

  override exportJSON(): SerializedComposerCaretAnchorNode {
    return {
      ...super.exportJSON(),
      type: "composer-caret-anchor",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    const dom = document.createElement("span");
    dom.textContent = ZERO_WIDTH_SPACE;
    return dom;
  }

  override updateDOM(): false {
    return false;
  }

  // Prevent the ZWSP from merging with text typed next to the pill: typing
  // at "[pill]|" creates a fresh text node after the anchor instead of
  // growing the anchor's text, so the anchor stays a pure caret anchor.
  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }
}

function $createComposerCaretAnchorNode() {
  return $applyNodeReplacement(new ComposerCaretAnchorNode());
}

function isComposerCaretAnchorNode(node: unknown): node is ComposerCaretAnchorNode {
  // Only a pure ZWSP node is a caret anchor. Once the user types into it the
  // text grows (e.g. "x\u200b") and it must behave as ordinary text again.
  return node instanceof ComposerCaretAnchorNode && node.getTextContent() === ZERO_WIDTH_SPACE;
}

/**
 * Remove a pill/chip node together with any caret anchors directly beside it,
 * so deleting a pill never leaves stray invisible ZWSP nodes behind. Used by
 * the Backspace/Delete handlers for atomic pill deletion.
 */
function removePillWithAnchors(pill: TextNode) {
  const previous = pill.getPreviousSibling();
  const next = pill.getNextSibling();
  pill.remove();
  if (isComposerCaretAnchorNode(previous)) previous.remove();
  if (isComposerCaretAnchorNode(next)) next.remove();
}

function createAttachmentChipDom(attachment: ComposerAttachmentToken) {
  const dom = document.createElement("span");
  dom.className = "relative mx-0.5 inline-flex h-10 max-w-[140px] shrink-0 items-center align-middle";
  dom.contentEditable = "false";
  dom.style.userSelect = "none";
  dom.setAttribute("spellcheck", "false");
  dom.title = attachment.name;
  dom.dataset.attachmentId = attachment.id;
  dom.dataset.attachmentStatus = "ready";

  if (attachment.kind === "image" && attachment.previewUrl) {
    const img = document.createElement("img");
    img.src = attachment.previewUrl;
    img.alt = attachment.name;
    img.decoding = "async";
    img.className = "h-10 w-10 rounded-xl border border-border/70 object-cover";
    dom.append(img);
  } else {
    const chip = document.createElement("span");
    chip.className = "inline-flex h-10 max-w-[140px] items-center gap-1.5 rounded-xl border border-border/70 bg-muted/40 px-2";
    const label = document.createElement("span");
    label.className = "truncate text-[11px] font-medium text-foreground";
    label.textContent = attachment.name;
    chip.append(label);
    dom.append(chip);
  }

  // Upload progress overlay: hidden by default, toggled through the chip's
  // data-attachment-status attribute while the draft's attachments are being
  // compressed/uploaded at send time (see syncAttachmentChipStatus).
  const spinner = document.createElement("span");
  spinner.dataset.attachmentSpinner = "true";
  spinner.className = "absolute inset-0 hidden items-center justify-center rounded-xl bg-background/60";
  const spinnerIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  spinnerIcon.setAttribute("viewBox", "0 0 24 24");
  spinnerIcon.setAttribute("fill", "none");
  spinnerIcon.setAttribute("class", "h-4 w-4 animate-spin text-foreground");
  const spinnerArc = document.createElementNS("http://www.w3.org/2000/svg", "path");
  spinnerArc.setAttribute("d", "M12 3a9 9 0 1 0 9 9");
  spinnerArc.setAttribute("stroke", "currentColor");
  spinnerArc.setAttribute("stroke-width", "2.5");
  spinnerArc.setAttribute("stroke-linecap", "round");
  spinnerIcon.append(spinnerArc);
  spinner.append(spinnerIcon);
  dom.append(spinner);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-xs leading-none text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground";
  remove.title = "Remove";
  remove.setAttribute("aria-label", `Remove ${attachment.name}`);
  remove.dataset.attachmentRemoveId = attachment.id;
  remove.textContent = "×";
  dom.append(remove);
  return dom;
}

/**
 * Toggle the uploading overlay on every attachment chip inside `root`.
 * Chips are raw Lexical token DOM (not React), so status is synced by
 * attribute instead of a re-render. Exported for the composer, which flips
 * this while a draft with attachments is being uploaded/sent.
 */
export function syncAttachmentChipStatus(root: HTMLElement, status: "uploading" | "ready") {
  for (const chip of root.querySelectorAll<HTMLElement>("[data-attachment-id]")) {
    chip.dataset.attachmentStatus = status;
    const spinner = chip.querySelector<HTMLElement>("[data-attachment-spinner]");
    if (!spinner) continue;
    spinner.classList.toggle("hidden", status !== "uploading");
    spinner.classList.toggle("flex", status === "uploading");
  }
}

function updateAttachmentChipDom(dom: HTMLElement, attachment: ComposerAttachmentToken) {
  dom.title = attachment.name;
  const remove = dom.querySelector("button[data-attachment-remove-id]");
  if (remove instanceof HTMLButtonElement) {
    remove.dataset.attachmentRemoveId = attachment.id;
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
  }
  const img = dom.querySelector("img");
  if (img instanceof HTMLImageElement && attachment.previewUrl) {
    img.src = attachment.previewUrl;
    img.alt = attachment.name;
  }
  const label = dom.querySelector("span.truncate");
  if (label) label.textContent = attachment.name;
}

type SerializedComposerAttachmentNode = Spread<
  {
    attachmentId: string;
    attachmentName: string;
    attachmentKind: "image" | "file";
    attachmentPreviewUrl?: string;
    type: "composer-attachment";
    version: 1;
  },
  SerializedTextNode
>;

class ComposerAttachmentNode extends TextNode {
  __attachmentId: string;
  __attachmentName: string;
  __attachmentKind: "image" | "file";
  __attachmentPreviewUrl?: string;

  static override getType() {
    return "composer-attachment";
  }

  static override clone(node: ComposerAttachmentNode) {
    return new ComposerAttachmentNode(
      {
        id: node.__attachmentId,
        name: node.__attachmentName,
        kind: node.__attachmentKind,
        previewUrl: node.__attachmentPreviewUrl,
      },
      node.__key,
    );
  }

  static override importJSON(serializedNode: SerializedComposerAttachmentNode) {
    return $createComposerAttachmentNode({
      id: serializedNode.attachmentId,
      name: serializedNode.attachmentName,
      kind: serializedNode.attachmentKind,
      previewUrl: serializedNode.attachmentPreviewUrl,
    });
  }

  constructor(attachment: ComposerAttachmentToken, key?: NodeKey) {
    super(`[attachment ${attachment.id}]`, key);
    this.__attachmentId = attachment.id;
    this.__attachmentName = attachment.name;
    this.__attachmentKind = attachment.kind;
    this.__attachmentPreviewUrl = attachment.previewUrl;
  }

  getAttachmentId() {
    return this.__attachmentId;
  }

  override exportJSON(): SerializedComposerAttachmentNode {
    return {
      ...super.exportJSON(),
      attachmentId: this.__attachmentId,
      attachmentName: this.__attachmentName,
      attachmentKind: this.__attachmentKind,
      attachmentPreviewUrl: this.__attachmentPreviewUrl,
      type: "composer-attachment",
      version: 1,
    };
  }

  override createDOM(_config: EditorConfig) {
    return createAttachmentChipDom({
      id: this.__attachmentId,
      name: this.__attachmentName,
      kind: this.__attachmentKind,
      previewUrl: this.__attachmentPreviewUrl,
    });
  }

  override updateDOM(prevNode: ComposerAttachmentNode, dom: HTMLElement) {
    if (
      prevNode.__attachmentId !== this.__attachmentId
      || prevNode.__attachmentName !== this.__attachmentName
      || prevNode.__attachmentKind !== this.__attachmentKind
      || prevNode.__attachmentPreviewUrl !== this.__attachmentPreviewUrl
    ) {
      updateAttachmentChipDom(dom, {
        id: this.__attachmentId,
        name: this.__attachmentName,
        kind: this.__attachmentKind,
        previewUrl: this.__attachmentPreviewUrl,
      });
    }
    return false;
  }

  override canInsertTextBefore(): false {
    return false;
  }

  override canInsertTextAfter(): false {
    return false;
  }

  override isTextEntity(): true {
    return true;
  }

  override isToken(): true {
    return true;
  }
}

function $createComposerAttachmentNode(attachment: ComposerAttachmentToken) {
  return $applyNodeReplacement(new ComposerAttachmentNode(attachment));
}

type ComposerInlineTokenNode =
  | ComposerMentionNode
  | ComposerSlashCommandNode
  | ComposerSkillNode
  | ComposerPastedTextNode
  | ComposerAttachmentNode;

function isComposerInlineTokenNode(node: unknown): node is ComposerInlineTokenNode {
  return node instanceof ComposerMentionNode
    || node instanceof ComposerSlashCommandNode
    || node instanceof ComposerSkillNode
    || node instanceof ComposerPastedTextNode
    || node instanceof ComposerAttachmentNode;
}

function appendSegmentWithNewlines(
  paragraph: ReturnType<typeof $createParagraphNode>,
  segment: string,
) {
  // Preserve newlines in plain text segments. A single paragraph cannot
  // render "\n" as a line break in contenteditable, so we split on "\n"
  // and start a new paragraph per line. Return the paragraph the caller
  // should keep appending to (i.e. the last one we produced).
  if (!segment.includes("\n")) {
    paragraph.append($createTextNode(segment));
    return paragraph;
  }
  const lines = segment.split("\n");
  let current = paragraph;
  lines.forEach((line, index) => {
    if (index > 0) {
      const next = $createParagraphNode();
      current.insertAfter(next);
      current = next;
    }
    if (line.length > 0) {
      current.append($createTextNode(line));
    }
  });
  return current;
}

function setPrompt(
  value: string,
  mentions: Record<string, ComposerMentionKind>,
  pastedText?: PastedTextToken[],
  attachments?: ComposerAttachmentToken[],
) {
  const root = $getRoot();
  root.clear();
  let paragraph = $createParagraphNode();
  root.append(paragraph);

  const slashMatch = value.match(/^\/(\S+)\s(.*)$/s);
  if (slashMatch?.[1]) {
    paragraph.append($createComposerSlashCommandNode(slashMatch[1]));
    paragraph.append($createTextNode(" "));
    value = slashMatch[2] ?? "";
  }

  const segments = value.split(/(\[attachment [^\]]+\]|\[pasted text [^\]]+\]|\[connect-skill [^\]]+\]|\[skill [^\]]+\]|@[^\s@]+)/);
  const pastedTextByLabel = new Map((pastedText ?? []).map((item) => [item.label, item]));
  const attachmentsById = new Map((attachments ?? []).map((item) => [item.id, item]));
  for (const segment of segments) {
    if (!segment) continue;
    const attachmentMatch = segment.match(/^\[attachment (.+)\]$/);
    if (attachmentMatch?.[1]) {
      const target = attachmentsById.get(attachmentMatch[1]);
      if (target) {
        paragraph.append($createComposerAttachmentNode(target));
        continue;
      }
    }
    const pasteMatch = segment.match(/^\[pasted text (.+)\]$/);
    if (pasteMatch?.[1]) {
      const target = pastedTextByLabel.get(pasteMatch[1]);
      if (target) {
        paragraph.append($createComposerPastedTextNode(target.label, target.lines));
        continue;
      }
    }
    const connectSkill = parseConnectSkillToken(segment);
    if (connectSkill) {
      paragraph.append($createComposerSkillNode(connectSkill.slug, segment));
      continue;
    }
    const skillMatch = segment.match(/^\[skill (.+)\]$/);
    if (skillMatch?.[1]) {
      paragraph.append($createComposerSkillNode(skillMatch[1]));
      continue;
    }
    if (segment.startsWith("@")) {
      const token = decodeComposerMentionValue(segment.slice(1));
      const kind = mentions[token];
      if (kind) {
        paragraph.append($createComposerMentionNode(token, kind));
        continue;
      }
    }
    paragraph = appendSegmentWithNewlines(paragraph, segment);
  }
}

function appendSkillAtEnd(skillName: string, skillToken?: string) {
  const root = $getRoot();
  const lastChild = root.getLastChild();
  const paragraph = $isElementNode(lastChild) ? lastChild : $createParagraphNode();
  if (!$isElementNode(lastChild)) root.append(paragraph);
  const skillNode = $createComposerSkillNode(skillName, skillToken);
  const spaceNode = $createTextNode(" ");
  paragraph.append(skillNode, spaceNode);
  setSelectionAfterNode(spaceNode);
}

function insertSkillAtSelection(skillName: string, skillToken?: string) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    appendSkillAtEnd(skillName, skillToken);
    return;
  }
  const skillNode = $createComposerSkillNode(skillName, skillToken);
  const spaceNode = $createTextNode(" ");
  selection.insertNodes([skillNode, spaceNode]);
  setSelectionAfterNode(spaceNode);
}

// Serialize the current editor state to the external draft string. Lexical's
// root.getTextContent() joins element children with "\n\n" (its "text content
// mode" for the root node), which causes single newlines typed/pasted by the
// user to round-trip as double newlines and quickly corrupts the draft. We
// walk root children ourselves and join with a single "\n" so every newline
// the user sees onscreen is preserved exactly in the stored draft.
function serializePromptFromRoot(): string {
  const root = $getRoot();
  return root
    .getChildren()
    .map((child) => child.getTextContent())
    .join("\n")
    .replaceAll(ZERO_WIDTH_SPACE, "");
}

function SyncPlugin(props: {
  value: string;
  mentions: Record<string, ComposerMentionKind>;
  pastedText?: PastedTextToken[];
  attachments?: ComposerAttachmentToken[];
  disabled: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const valueRef = useRef(props.value);

  useEffect(() => {
    editor.setEditable(!props.disabled);
  }, [editor, props.disabled]);

  useEffect(() => {
    // When the external value is cleared (e.g. after sending a message),
    // always force-rebuild the editor to remove any stale chip nodes.
    // The valueRef check can false-positive when both refs converge to ""
    // through different paths (SyncPlugin vs OnChange).
    //
    // NOTE: serializePromptFromRoot() calls $getRoot() which requires an
    // active editor state. Outside of editor.update()/editor.read() we
    // must wrap it in editor.getEditorState().read().
    const currentText = editor.getEditorState().read(() => serializePromptFromRoot());
    const forceRebuild = !props.value.trim() && currentText.trim() !== "";
    // If the draft contains paste placeholders that are not yet materialized
    // as pill nodes (e.g. right after PasteChipPlugin inserted the token and
    // the paste part was registered), rebuild even though the serialized text
    // matches — the text check alone would skip the placeholder -> pill swap.
    const unresolvedPlaceholders = editor.getEditorState().read(() => {
      const text = serializePromptFromRoot();
      if (!/\[pasted text [^\]]+\]/.test(text)) return false;
      return $nodesOfType(ComposerPastedTextNode).length === 0;
    });
    if (!forceRebuild && !unresolvedPlaceholders && valueRef.current === props.value) return;
    valueRef.current = props.value;
    // Check whether the editor already reflects the desired state BEFORE
    // entering editor.update(). Even a bail-out inside editor.update()
    // triggers Lexical's reconciliation cycle which can normalise the DOM
    // selection and reset the cursor (e.g. after a multi-line paste the
    // cursor jumps to position 0 instead of staying after the pasted
    // content). The read() above already gave us `currentText` — reuse it.
    if (!forceRebuild && !unresolvedPlaceholders && currentText === props.value) return;
    editor.update(() => {
      // Double-check inside the update in case another queued update
      // changed the state between the read above and this callback.
      if (!forceRebuild && !unresolvedPlaceholders && serializePromptFromRoot() === props.value) return;
      setPrompt(props.value, props.mentions, props.pastedText, props.attachments);
      // $getRoot().selectEnd() doesn't work when the last node is a
      // token (chip) — Lexical can't position a cursor inside a token,
      // so the selection collapses to position 0. Use element-level
      // selection instead: place the cursor *after* the last child of
      // the last paragraph.
      const lastParagraph = $getRoot().getLastChild();
      if ($isElementNode(lastParagraph)) {
        const childCount = lastParagraph.getChildrenSize();
        lastParagraph.select(childCount, childCount);
      } else {
        $getRoot().selectEnd();
      }
    });
  }, [editor, props.attachments, props.mentions, props.pastedText, props.value]);

  return null;
}

function SubmitPlugin(props: { onSubmit: (options: { queue: boolean }) => void | Promise<void>; disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  const onSubmitRef = useRef(props.onSubmit);

  useEffect(() => {
    onSubmitRef.current = props.onSubmit;
  }, [props.onSubmit]);

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (props.disabled) return false;
        // IME composition guard: three signals keep this reliable across
        // Chrome, Safari, and WebKit. While IME is mid-character, Enter
        // must always fall through to the editor so the composition can
        // commit.
        if (event?.isComposing === true || event?.keyCode === 229) return false;
        // Shift+Enter inserts a newline — let the editor handle it.
        if (event?.shiftKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        // Plain Enter submits. Cmd/Ctrl+Enter is the modifier: while the
        // agent is busy, Enter queues and the modifier steers.
        event?.preventDefault();
        void onSubmitRef.current({ queue: event?.metaKey === true || event?.ctrlKey === true });
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, props.disabled]);

  return null;
}

function appendPastedTextMeasurement(element: HTMLElement, text: string) {
  const paragraph = document.createElement("p");
  for (const segment of splitPastedText(text)) {
    if (segment.kind === "line-break") {
      paragraph.append(document.createElement("br"));
    } else if (segment.kind === "tab") {
      paragraph.append(document.createTextNode("\t"));
    } else {
      paragraph.append(document.createTextNode(segment.text));
    }
  }
  element.append(paragraph);
}

function pastedTextWouldOverflowEditor(text: string, editorElement: HTMLElement | null) {
  if (!editorElement) return false;
  const bounds = editorElement.getBoundingClientRect();
  if (bounds.width <= 0) return false;

  const measurement = editorElement.cloneNode(false);
  if (!(measurement instanceof HTMLElement)) return false;
  measurement.setAttribute("aria-hidden", "true");
  measurement.style.position = "fixed";
  measurement.style.left = "-10000px";
  measurement.style.top = "0";
  measurement.style.width = `${bounds.width}px`;
  measurement.style.height = "auto";
  measurement.style.minHeight = "0";
  measurement.style.visibility = "hidden";
  measurement.style.pointerEvents = "none";
  appendPastedTextMeasurement(measurement, text);
  document.body.append(measurement);

  try {
    return measurement.scrollHeight > measurement.clientHeight;
  } finally {
    measurement.remove();
  }
}

function PasteChipPlugin(props: { onPasteText?: (text: string, placeholder: string, chip: PastedTextToken, serializedAfterInsert?: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const onPasteTextRef = useRef(props.onPasteText);

  useEffect(() => {
    onPasteTextRef.current = props.onPasteText;
  }, [props.onPasteText]);

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        if (event.defaultPrevented) return false;
        // Only handle plain-text pastes; files and URI lists are handled in the React onPaste.
        const files = event.clipboardData?.files;
        if (files && files.length > 0) return false;
        if (event.clipboardData?.getData("text/uri-list").trim()) return false;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text.trim()) return false;
        const wouldOverflowComposer = pastedTextWouldOverflowEditor(text, editor.getRootElement());
        if (shouldCollapsePastedText(text, wouldOverflowComposer)) {
          if (!onPasteTextRef.current) return false;
          event.preventDefault();
          // Insert the actual pill node at the caret (replacing any
          // selection), so the collapsed paste lands exactly where the cursor
          // is. Inserting the node directly — instead of a plain-text
          // placeholder plus a SyncPlugin rebuild — keeps the cursor in place
          // (no rebuild, no selectEnd) and makes undo remove the pill cleanly.
          // The chip (and its random label) is created here so the pill's
          // serialized `[pasted text <label>]` matches the registered part.
          const chip = createPastedTextChip(text);
          let serializedAfterInsert = "";
          editor.update(() => {
            // The draft round-trip (OnChange -> store -> SyncPlugin rebuild)
            // can leave Lexical's model selection stale (e.g. parked at the
            // end of the last paragraph) while the DOM caret sits elsewhere.
            // Rebuild the model selection from the live DOM selection so the
            // pill lands exactly where the cursor actually is.
            const domSelection = getDOMSelection(window);
            let selection = $getSelection();
            if (domSelection && domSelection.rangeCount > 0) {
              const fromDom = $createRangeSelectionFromDom(domSelection, editor);
              if (fromDom) selection = fromDom;
            }
            if (!$isRangeSelection(selection)) {
              $getRoot().selectEnd();
              selection = $getSelection();
            }
            if (!$isRangeSelection(selection)) return false;
            // Force the model selection to match before inserting; Lexical's
            // PASTE_COMMAND can leave a stale/mismatched selection.
            $setSelection(selection);
            const pillNode = $createComposerPastedTextNode(chip.label, chip.lines);
            selection.insertNodes([pillNode]);
            // Chrome cannot paint a caret at a bare element boundary next to a
            // contenteditable=false inline: when the pill is pasted at the very
            // start or end of a line (no editable text neighbor), the caret
            // renders INSIDE the pill ("[pill|]") instead of at its edge.
            // Anchor the caret in a zero-width-space text node on the pill's
            // right (and left) so the boundary stays paintable. The ZWSPs are
            // stripped from the serialized draft, so they never reach the
            // stored text or the sent message.
            if (!$isTextNode(pillNode.getPreviousSibling())) {
              pillNode.insertBefore($createComposerCaretAnchorNode());
            }
            if (!$isTextNode(pillNode.getNextSibling())) {
              pillNode.insertAfter($createComposerCaretAnchorNode());
            }
            setSelectionAfterNode(pillNode);
            serializedAfterInsert = serializePromptFromRoot();
          });
          onPasteTextRef.current(text, "", chip, serializedAfterInsert);
          return true;
        }
        event.preventDefault();
        return insertPastedText(text);
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor]);

  return null;
}

function pastedExpandButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const button = target.closest("button[data-pasted-expand-label]");
  return button instanceof HTMLButtonElement ? button : null;
}

function replacePastedTextChip(label: string, text: string, button: HTMLButtonElement) {
  const nearest = $getNearestNodeFromDOMNode(button);
  if (nearest instanceof ComposerPastedTextNode && nearest.getPastedLabel() === label) {
    nearest.select(0, nearest.getTextContentSize());
    return insertPastedText(text);
  }
  for (const node of $nodesOfType(ComposerPastedTextNode)) {
    if (node.getPastedLabel() !== label) continue;
    node.select(0, node.getTextContentSize());
    return insertPastedText(text);
  }
  return false;
}

function PastedTextExpandPlugin(props: { pastedText?: PastedTextToken[]; onExpandPastedText?: (label: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const pastedTextRef = useRef(props.pastedText);
  const onExpandPastedTextRef = useRef(props.onExpandPastedText);

  useEffect(() => {
    pastedTextRef.current = props.pastedText;
    onExpandPastedTextRef.current = props.onExpandPastedText;
  }, [props.onExpandPastedText, props.pastedText]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (!pastedExpandButton(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleClick = (event: MouseEvent) => {
      const button = pastedExpandButton(event.target);
      if (!button) return;
      const label = button.dataset.pastedExpandLabel;
      if (!label) return;
      event.preventDefault();
      event.stopPropagation();
      const target = pastedTextRef.current?.find((item) => item.label === label);
      if (target) {
        editor.update(() => {
          replacePastedTextChip(label, target.text, button);
        });
      }
      onExpandPastedTextRef.current?.(label);
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("mousedown", handleMouseDown, true);
      previousRootElement?.removeEventListener("click", handleClick, true);
      rootElement?.addEventListener("mousedown", handleMouseDown, true);
      rootElement?.addEventListener("click", handleClick, true);
    });
  }, [editor]);

  return null;
}

function MentionChipNavigationPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // The caret must never sit on a token chip's text node at all — neither
    // strictly inside its hidden text (the pill shows "Pasted · 196 lines"
    // but the model text is "[pasted text x · 196 lines]") nor at the
    // boundary offsets 0 / size. Native navigation (arrows, Home/End,
    // Ctrl+arrows, clicks, paste) can leave the DOM caret on the pill's span,
    // which Lexical maps onto an offset within the hidden text — then
    // Backspace/Delete do nothing (a lone pill has no text sibling to delete
    // from) and Enter splits the hidden text into visible garbage. Enforce
    // the invariant on every selection change: snap to the nearest boundary
    // outside the chip (before it at offset 0, after it otherwise).
    const unregisterSelectionGuard = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchor = selection.anchor;
        if (anchor.type !== "text") return false;
        const node = anchor.getNode();
        if (!isComposerInlineTokenNode(node)) return false;
        if (anchor.offset <= 0) {
          setSelectionBeforeNode(node);
        } else {
          setSelectionAfterNode(node);
        }
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    // The plain End/Home keys are not Lexical commands (only Ctrl+ArrowRight
    // maps to MOVE_TO_END), so the browser moves the caret to the end of the
    // DOM line natively. When the caret sits next to a token chip, the
    // browser may drop it inside the chip's span, which Lexical maps onto an
    // offset within the token's hidden text — then Shift+Enter splits that
    // hidden text, leaking fragments like "· 196 lines]" onto the new line.
    // Snap End/Home to the token boundary (just before/after the chip on the
    // current line), not the paragraph start — paragraph start would jump to
    // the first line in a multiline draft.
    const unregisterEndHome = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (event.key !== "End" && event.key !== "Home") return false;
        // Ctrl/Cmd+Arrow variants are Lexical's MOVE_TO_END/MOVE_TO_START.
        if (event.ctrlKey || event.metaKey) return false;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        // Resolve the token this caret is inside or adjacent to.
        const token = adjacentTokenForSelection(selection);
        if (!token) return false;
        if (event.key === "End") {
          setSelectionAfterNode(token);
        } else {
          setSelectionBeforeNode(token);
        }
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    // Ctrl+ArrowLeft/Right dispatch MOVE_TO_START/MOVE_TO_END (word-boundary
    // navigation). With a token on the line, the native move can drop the
    // caret inside the chip's span; snap to the token boundary instead.
    // Ctrl+ArrowLeft/Right dispatch MOVE_TO_START/MOVE_TO_END (word-boundary
    // navigation). Treat the pill as a word boundary: from "foo[pill]bar|",
    // Ctrl+Left should stop before the pill ("foo|[pill]bar") rather than
    // jump past it to the line start, and Ctrl+Right from "foo|[pill]bar"
    // should stop after it ("foo[pill]|bar") rather than jump to the end.
    const unregisterMoveStartEnd = editor.registerCommand(
      MOVE_TO_START,
      (event: KeyboardEvent | null) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        // If we are at the start of a paragraph that follows one ending in a
        // pill, land after that pill (end of the previous line).
        const previousToken = previousParagraphEndsWithToken(selection);
        if (previousToken) {
          setSelectionAfterNode(previousToken);
          event?.preventDefault();
          return true;
        }
        const lineBreakToken = tokenBeforeLineBreak(selection);
        if (lineBreakToken) {
          setSelectionAfterNode(lineBreakToken);
          event?.preventDefault();
          return true;
        }
        // Ctrl+Left treats the pill as a word: the caret moves to the START of
        // the word it is in, which stops at the pill's right edge when coming
        // from the right ("foo[pill]bar|" -> "foo[pill]|bar"), and only a
        // caret already sitting at the right edge crosses to before the pill.
        const anchorNode = selection.anchor.getNode();
        if (isComposerInlineTokenNode(anchorNode)) {
          // Caret inside the pill: Ctrl+Left exits to its left edge.
          setSelectionBeforeNode(anchorNode);
          event?.preventDefault();
          return true;
        }
        const token = tokenBeforeCaretInParagraph(selection);
        if (token) {
          const caret = caretParagraphOffset(selection);
          if (caret !== null && caret >= token.getIndexWithinParent() + 1) {
            if (caretAtTokenRightEdge(selection, token)) {
              setSelectionBeforeNode(token);
            } else {
              setSelectionAfterNode(token);
            }
            event?.preventDefault();
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterMoveEnd = editor.registerCommand(
      MOVE_TO_END,
      (event: KeyboardEvent | null) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        // If we are at the end of a paragraph that is followed by one
        // starting with a pill, land before that pill (start of the next
        // line).
        const nextToken = nextParagraphStartsWithToken(selection);
        if (nextToken) {
          setSelectionBeforeNode(nextToken);
          event?.preventDefault();
          return true;
        }
        const lineBreakToken = tokenAfterLineBreak(selection);
        if (lineBreakToken) {
          setSelectionBeforeNode(lineBreakToken);
          event?.preventDefault();
          return true;
        }
        // Ctrl+Right treats the pill as a word: the caret moves to the END of
        // the word it is in, which stops at the pill's left edge when coming
        // from the left ("|foo[pill]bar" -> "foo|[pill]bar"), and only a
        // caret already sitting at the left edge crosses to after the pill.
        const anchorNode = selection.anchor.getNode();
        if (isComposerInlineTokenNode(anchorNode)) {
          // Caret inside the pill: Ctrl+Right exits to its right edge.
          setSelectionAfterNode(anchorNode);
          event?.preventDefault();
          return true;
        }
        const token = tokenAfterCaretInParagraph(selection);
        if (token) {
          const caret = caretParagraphOffset(selection);
          if (caret !== null && caret <= token.getIndexWithinParent()) {
            if (caretAtTokenLeftEdge(selection, token)) {
              setSelectionAfterNode(token);
            } else {
              setSelectionBeforeNode(token);
            }
            event?.preventDefault();
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    // Up/Down arrow navigation stays native: the browser moves vertically
    // between lines itself, and a caret that lands inside a chip's span is
    // snapped out by the DOM selectionchange guard (user-select:none keeps
    // the caret from being selectable inside the pill). Intercepting Up/Down
    // here used to pin the caret to the pill boundary and block reaching the
    // line above/below.

    // Clicking inside a token chip (paste pill text, mention label, etc.)
    // must never place the caret inside the chip's DOM — Lexical maps that
    // onto an offset within the token's hidden model text. Snap the caret to
    // after the node instead. The Expand/remove buttons are excluded; their
    // own plugins handle them. Only clicks that resolve to a token chip are
    // intercepted — everything else keeps the browser's default caret
    // placement so clicking normal text still works.
    const handleChipMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("button")) return;
      const targetNode = event.target;
      let chipNode: ComposerInlineTokenNode | null = null;
      // Use editor.read() (not getEditorState().read()) so the active-editor
      // context is set — $getNearestNodeFromDOMNode requires it.
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(targetNode);
        if (isComposerInlineTokenNode(node)) chipNode = node;
      });
      if (!chipNode) return;
      event.preventDefault();
      event.stopPropagation();
      const target = chipNode;
      editor.update(() => {
        setSelectionAfterNode(target);
      });
    };

    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchorNode = selection.anchor.getNode();

        // --- Caret anchor: never delete the invisible ZWSP itself ---
        // A caret in the anchor after a pill ("[pill]|") backspaces into the
        // pill (atomic delete); a caret in the anchor before a pill
        // ("|[pill]") moves before the anchor so the native handler deletes
        // whatever precedes the pill instead.
        if (isComposerCaretAnchorNode(anchorNode)) {
          const previous = anchorNode.getPreviousSibling();
          if (isComposerInlineTokenNode(previous) && !(previous instanceof ComposerSlashCommandNode)) {
            removePillWithAnchors(previous);
            return true;
          }
          setSelectionBeforeNode(anchorNode);
          return false;
        }

        // --- Slash command chip: atomic delete ---
        // When cursor is in the text node right after a slash chip,
        // remove the chip (and any trailing whitespace text) in one action.
        if ($isTextNode(anchorNode)) {
          const previous = anchorNode.getPreviousSibling();
          if (previous instanceof ComposerSlashCommandNode) {
            // At offset 0: cursor is right after the chip -> remove chip
            // At offset > 0 but text is only whitespace: also remove chip
            const textBefore = anchorNode.getTextContent().slice(0, selection.anchor.offset);
            if (selection.anchor.offset === 0 || textBefore.trim() === "") {
              previous.remove();
              // Also remove the whitespace-only prefix
              if (selection.anchor.offset > 0) {
                const remaining = anchorNode.getTextContent().slice(selection.anchor.offset);
                if (remaining) {
                  anchorNode.setTextContent(remaining);
                  const sel = $createRangeSelection();
                  sel.anchor.set(anchorNode.getKey(), 0, "text");
                  sel.focus.set(anchorNode.getKey(), 0, "text");
                  $setSelection(sel);
                } else {
                  anchorNode.remove();
                }
              }
              return true;
            }
          }
        }

        // --- Mention / pasted-text / attachment chips: atomic delete ---
        if ($isTextNode(anchorNode) && selection.anchor.offset === 0) {
          const previous = anchorNode.getPreviousSibling();
          if (isComposerInlineTokenNode(previous) && !(previous instanceof ComposerSlashCommandNode)) {
            removePillWithAnchors(previous);
            return true;
          }
        }

        if ($isElementNode(anchorNode)) {
          const previous = anchorNode.getChildAtIndex(selection.anchor.offset - 1);
          if (isComposerInlineTokenNode(previous)) {
            removePillWithAnchors(previous);
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterDelete = editor.registerCommand(
      KEY_DELETE_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchorNode = selection.anchor.getNode();

        // --- Caret anchor: never delete the invisible ZWSP itself ---
        // A caret in the anchor before a pill ("|[pill]") deletes forward into
        // the pill (atomic delete); a caret in the anchor after a pill
        // ("[pill]|") moves after the anchor so the native handler deletes
        // whatever follows the pill instead.
        if (isComposerCaretAnchorNode(anchorNode)) {
          const next = anchorNode.getNextSibling();
          if (isComposerInlineTokenNode(next) && !(next instanceof ComposerSlashCommandNode)) {
            removePillWithAnchors(next);
            return true;
          }
          setSelectionAfterNode(anchorNode);
          return false;
        }

        // --- Slash command chip: atomic delete (forward) ---
        // When cursor is in the text node right before a slash chip,
        // remove the chip (and any trailing whitespace text) in one action.
        if ($isTextNode(anchorNode)) {
          const next = anchorNode.getNextSibling();
          if (next instanceof ComposerSlashCommandNode) {
            const textAfter = anchorNode.getTextContent().slice(selection.anchor.offset);
            if (selection.anchor.offset === anchorNode.getTextContentSize() || textAfter.trim() === "") {
              next.remove();
              // Also remove the whitespace-only suffix
              if (selection.anchor.offset < anchorNode.getTextContentSize()) {
                const remaining = anchorNode.getTextContent().slice(0, selection.anchor.offset);
                if (remaining) {
                  anchorNode.setTextContent(remaining);
                  const sel = $createRangeSelection();
                  sel.anchor.set(anchorNode.getKey(), remaining.length, "text");
                  sel.focus.set(anchorNode.getKey(), remaining.length, "text");
                  $setSelection(sel);
                } else {
                  anchorNode.remove();
                }
              }
              return true;
            }
          }
        }

        // --- Mention / pasted-text / attachment chips: atomic delete (forward) ---
        if ($isTextNode(anchorNode) && selection.anchor.offset === anchorNode.getTextContentSize()) {
          const next = anchorNode.getNextSibling();
          if (isComposerInlineTokenNode(next) && !(next instanceof ComposerSlashCommandNode)) {
            removePillWithAnchors(next);
            return true;
          }
        }

        if ($isElementNode(anchorNode)) {
          const next = anchorNode.getChildAtIndex(selection.anchor.offset);
          if (isComposerInlineTokenNode(next)) {
            removePillWithAnchors(next);
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    // Shift+Enter while the caret sits in a caret anchor next to a pill must
    // keep the anchor attached to the pill. Lexical's default linebreak
    // insertion splits at the caret offset — inside the anchor — leaving the
    // leading anchor on the old line and the pill starting the new line with
    // no editable neighbor, so the caret paints inside the pill.
    const unregisterInsertLineBreak = editor.registerCommand(
      INSERT_LINE_BREAK_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchorNode = selection.anchor.getNode();
        if (!isComposerCaretAnchorNode(anchorNode)) return false;
        const previous = anchorNode.getPreviousSibling();
        const next = anchorNode.getNextSibling();
        const pill = isComposerInlineTokenNode(previous)
          ? previous
          : isComposerInlineTokenNode(next)
            ? next
            : null;
        if (!pill) return false;
        // Leading anchor ("|[pill]"): the linebreak goes before the anchor so
        // the anchor stays at the start of the pill's new line and the caret
        // stays in it. Trailing anchor ("[pill]|"): the linebreak goes after
        // the anchor so the caret moves to the new (empty) line.
        const lineBreak = $createLineBreakNode();
        if (next === pill) {
          anchorNode.insertBefore(lineBreak);
        } else {
          anchorNode.insertAfter(lineBreak);
          const parent = anchorNode.getParent();
          if (parent && $isElementNode(parent)) {
            const sel = $createRangeSelection();
            const offset = anchorNode.getIndexWithinParent() + 2;
            sel.anchor.set(parent.getKey(), offset, "element");
            sel.focus.set(parent.getKey(), offset, "element");
            $setSelection(sel);
          }
        }
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event: KeyboardEvent | null) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchorNode = selection.anchor.getNode();

        if (isComposerCaretAnchorNode(anchorNode)) {
          // The caret is inside the invisible ZWSP anchor next to a pill:
          // Left treats it as being at the pill boundary on the anchor's
          // side — a trailing anchor ("[pill]|") crosses before the pill, a
          // leading anchor ("|[pill]") continues past the anchor to whatever
          // precedes it.
          if (isComposerInlineTokenNode(anchorNode.getPreviousSibling())) {
            setSelectionBeforeNode(anchorNode.getPreviousSibling() as TextNode);
          } else {
            setSelectionBeforeNode(anchorNode);
          }
          event?.preventDefault();
          return true;
        }

        if (isComposerInlineTokenNode(anchorNode)) {
          setSelectionBeforeNode(anchorNode);
          event?.preventDefault();
          return true;
        }

        // At the very start of a paragraph whose previous line ends in a
        // pill: crossing the line boundary should land after that pill (end
        // of the previous line), not before it.
        const previousToken = previousParagraphEndsWithToken(selection);
        if (previousToken) {
          setSelectionAfterNode(previousToken);
          event?.preventDefault();
          return true;
        }

        // Same for soft line breaks inside one paragraph: a pill ending the
        // previous visual line means Left crosses to after it.
        const lineBreakToken = tokenBeforeLineBreak(selection);
        if (lineBreakToken) {
          setSelectionAfterNode(lineBreakToken);
          event?.preventDefault();
          return true;
        }

        if ($isTextNode(anchorNode) && selection.anchor.offset === 0) {
          const previous = anchorNode.getPreviousSibling();
          if (isComposerInlineTokenNode(previous)) {
            setSelectionBeforeNode(previous);
            event?.preventDefault();
            return true;
          }
        }

        if ($isElementNode(anchorNode)) {
          const previous = anchorNode.getChildAtIndex(selection.anchor.offset - 1);
          // A caret anchor between the caret and the pill is invisible: look
          // through it so crossing from past the trailing anchor lands before
          // the pill in one press.
          const target = isComposerCaretAnchorNode(previous)
            ? previous.getPreviousSibling()
            : previous;
          if (isComposerInlineTokenNode(target)) {
            setSelectionBeforeNode(target);
            event?.preventDefault();
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event: KeyboardEvent | null) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
        const anchorNode = selection.anchor.getNode();

        if (isComposerCaretAnchorNode(anchorNode)) {
          // Mirror of Left: a leading anchor ("|[pill]") crosses to after the
          // pill, a trailing anchor ("[pill]|") continues past the anchor to
          // whatever follows it.
          if (isComposerInlineTokenNode(anchorNode.getNextSibling())) {
            setSelectionAfterNode(anchorNode.getNextSibling() as TextNode);
          } else {
            setSelectionAfterNode(anchorNode);
          }
          event?.preventDefault();
          return true;
        }

        if (isComposerInlineTokenNode(anchorNode)) {
          setSelectionAfterNode(anchorNode);
          event?.preventDefault();
          return true;
        }

        // At the very end of a paragraph whose next line starts with a pill:
        // crossing the line boundary should land before that pill (start of
        // the next line), not after it.
        const nextToken = nextParagraphStartsWithToken(selection);
        if (nextToken) {
          setSelectionBeforeNode(nextToken);
          event?.preventDefault();
          return true;
        }

        // Same for soft line breaks inside one paragraph: a pill starting the
        // next visual line means Right crosses to before it.
        const lineBreakToken = tokenAfterLineBreak(selection);
        if (lineBreakToken) {
          setSelectionBeforeNode(lineBreakToken);
          event?.preventDefault();
          return true;
        }

        if ($isElementNode(anchorNode)) {
          const current = anchorNode.getChildAtIndex(selection.anchor.offset);
          // A caret anchor between the caret and the pill is invisible: look
          // through it so crossing from before the leading anchor lands after
          // the pill in one press.
          const target = isComposerCaretAnchorNode(current)
            ? current.getNextSibling()
            : current;
          if (isComposerInlineTokenNode(target)) {
            setSelectionAfterNode(target);
            event?.preventDefault();
            return true;
          }
        }

        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterRootListener = editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("mousedown", handleChipMouseDown, true);
      rootElement?.addEventListener("mousedown", handleChipMouseDown, true);

      // DOM-level guard: if the native caret ever lands inside a chip span
      // (a lone pill after paste, or after clicking near it, the browser can
      // place the caret inside the contenteditable=false span — visible as a
      // yellow caret in the amber pill text), snap the DOM selection to the
      // nearest chip edge. The Lexical model guard alone can't move the
      // native caret; this closes the loop so native navigation (arrows, word
      // jumps) always starts from outside the chip. Which edge depends on
      // where in the pill the caret landed: near its start -> before the
      // pill, near its end -> after.
      const handleDomSelectionChange = () => {
        const domSelection = getDOMSelection(window);
        if (!domSelection || domSelection.rangeCount === 0) return;
        const range = domSelection.getRangeAt(0);
        if (!range.collapsed) return;
        const anchor = range.startContainer;
        const chip = anchor instanceof Element
          ? anchor.closest("[contenteditable='false']")
          : anchor.parentElement?.closest("[contenteditable='false']");
        if (!chip) return;
        // Ignore the Expand/remove buttons: their own handlers manage them.
        if (anchor instanceof Element && anchor.closest("button")) return;
        if (anchor instanceof Text && anchor.parentElement?.closest("button")) return;
        let chipNode: ComposerInlineTokenNode | null = null;
        // Use editor.read() (not getEditorState().read()) so the active-editor
        // context is set — $getNearestNodeFromDOMNode requires it.
        editor.read(() => {
          const node = $getNearestNodeFromDOMNode(chip);
          if (isComposerInlineTokenNode(node)) chipNode = node;
        });
        if (!chipNode) return;
        const target = chipNode;
        // Snap to the nearer edge of the pill. A text caret at offset 0 (or
        // an element caret at the chip's first child) means the browser
        // parked it at the pill's left boundary -> before the pill; a caret
        // at the end of the text (or last child) -> after the pill.
        let snapBefore = false;
        if (anchor instanceof Text) {
          const size = anchor.textContent?.length ?? 0;
          snapBefore = size > 0
            ? domSelection.anchorOffset <= Math.floor(size / 2)
            : domSelection.anchorOffset === 0;
        } else if (anchor instanceof Element) {
          snapBefore = domSelection.anchorOffset === 0;
        }
        editor.update(() => {
          if (snapBefore) {
            setSelectionBeforeNode(target);
          } else {
            setSelectionAfterNode(target);
          }
        });
      };

      const nextDoc = rootElement?.ownerDocument;
      if (nextDoc) {
        nextDoc.addEventListener("selectionchange", handleDomSelectionChange, true);
      }
      const prevDoc = previousRootElement?.ownerDocument;
      if (prevDoc) {
        prevDoc.removeEventListener("selectionchange", handleDomSelectionChange, true);
      }
    });

    return () => {
      unregisterSelectionGuard();
      unregisterEndHome();
      unregisterMoveStartEnd();
      unregisterMoveEnd();
      unregisterBackspace();
      unregisterDelete();
      unregisterInsertLineBreak();
      unregisterLeft();
      unregisterRight();
      unregisterRootListener();
    };
  }, [editor]);

  return null;
}

function ImperativeHandlePlugin(props: { editorRef: ForwardedRef<LexicalPromptEditorHandle> }) {
  const [editor] = useLexicalComposerContext();

  useImperativeHandle(props.editorRef, () => ({
    insertSkillAtSelection(skillName: string, skillToken?: string) {
      editor.update(() => insertSkillAtSelection(skillName, skillToken));
      editor.focus();
    },
  }), [editor]);

  return null;
}

function attachmentRemoveButton(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const button = target.closest("button[data-attachment-remove-id]");
  return button instanceof HTMLButtonElement ? button : null;
}

function AttachmentRemovePlugin(props: { onRemoveAttachment?: (id: string) => void }) {
  const [editor] = useLexicalComposerContext();
  const onRemoveAttachmentRef = useRef(props.onRemoveAttachment);

  useEffect(() => {
    onRemoveAttachmentRef.current = props.onRemoveAttachment;
  }, [props.onRemoveAttachment]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (!attachmentRemoveButton(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const handleClick = (event: MouseEvent) => {
      const button = attachmentRemoveButton(event.target);
      if (!button) return;
      const id = button.dataset.attachmentRemoveId;
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      onRemoveAttachmentRef.current?.(id);
    };

    return editor.registerRootListener((rootElement, previousRootElement) => {
      previousRootElement?.removeEventListener("mousedown", handleMouseDown, true);
      previousRootElement?.removeEventListener("click", handleClick, true);
      rootElement?.addEventListener("mousedown", handleMouseDown, true);
      rootElement?.addEventListener("click", handleClick, true);
    });
  }, [editor]);

  return null;
}

export const LexicalPromptEditor = forwardRef<LexicalPromptEditorHandle, EditorProps>(function LexicalPromptEditor(props, ref) {
  const valueRef = useRef(props.value);
  const onChangeRef = useRef(props.onChange);

  useEffect(() => {
    valueRef.current = props.value;
  }, [props.value]);

  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  const initialConfig = useMemo(
    () => ({
      namespace: "openwork-react-session-composer",
      onError(error: Error) {
        throw error;
      },
        editable: !props.disabled,
        nodes: [ComposerMentionNode, ComposerSlashCommandNode, ComposerSkillNode, ComposerPastedTextNode, ComposerAttachmentNode, ComposerCaretAnchorNode],
        editorState: () => {
          setPrompt(props.value, props.mentions, props.pastedText, props.attachments);
        },
      }),
    [],
  );

  const syncPromptFromEditorState = useCallback(
    (state: Parameters<NonNullable<React.ComponentProps<typeof OnChangePlugin>["onChange"]>>[0]) => {
      state.read(() => {
        const next = serializePromptFromRoot();
        if (next === valueRef.current) return;
        valueRef.current = next;
        onChangeRef.current(next);
      });
    },
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {/*
        Tight start, bounded growth:
        - min-h holds the editor to a single-line look until the user starts typing.
        - max-h caps the composer — long pastes / multi-paragraph drafts scroll
          inside the editor instead of pushing the transcript out of view.
      */}
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              className="min-h-[60px] max-h-[280px] w-full resize-none overflow-y-auto bg-transparent text-base leading-6 text-dls-text outline-none placeholder:text-dls-secondary lg:text-[13px] lg:leading-[1.55] [&_p]:min-h-[1.5rem] [&_p]:m-0"
              aria-placeholder={props.placeholder}
              placeholder={<span />}
              onPaste={props.onPaste}
              onDrop={props.onDrop}
              onDragOver={props.onDragOver}
              onDragLeave={props.onDragLeave}
            />
          }
          placeholder={
            <div className="pointer-events-none absolute left-0 top-0 text-base leading-6 text-dls-secondary/70 lg:text-[13px] lg:leading-[1.55]">
              {props.placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={syncPromptFromEditorState} />
        <HistoryPlugin />
        <SyncPlugin
          value={props.value}
          mentions={props.mentions}
          pastedText={props.pastedText}
          attachments={props.attachments}
          disabled={props.disabled}
        />
        <SubmitPlugin onSubmit={props.onSubmit} disabled={props.disabled} />
        <PasteChipPlugin onPasteText={props.onPasteText} />
        <PastedTextExpandPlugin pastedText={props.pastedText} onExpandPastedText={props.onExpandPastedText} />
        <AttachmentRemovePlugin onRemoveAttachment={props.onRemoveAttachment} />
        <MentionChipNavigationPlugin />
        <ImperativeHandlePlugin editorRef={ref} />
      </div>
    </LexicalComposer>
  );
});
