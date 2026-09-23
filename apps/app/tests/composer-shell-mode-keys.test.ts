import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const ownedDom = typeof window === "undefined";
if (ownedDom) GlobalRegistrator.register({ url: "http://localhost/" });

import {
  isCaretAtEditorStart,
  shouldExitShellModeOnBackspace,
} from "../src/react-app/domains/session/surface/composer/shell-mode-keys";

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});
afterAll(() => {
  if (ownedDom) GlobalRegistrator.unregister();
});

function key(key: string, modifiers: Partial<Record<"shiftKey" | "metaKey" | "ctrlKey" | "altKey", boolean>> = {}) {
  return { key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...modifiers };
}

function placeCaret(anchor: Node, offset: number, focus?: { node: Node; offset: number }) {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  const range = document.createRange();
  if (focus) {
    range.setStart(anchor, offset);
    range.setEnd(focus.node, focus.offset);
  } else {
    range.setStart(anchor, offset);
    range.collapse(true);
  }
  selection.addRange(range);
}

function editorWithText(text: string) {
  const root = document.createElement("div");
  root.contentEditable = "true";
  root.append(document.createTextNode(text));
  document.body.append(root);
  return root;
}

describe("shouldExitShellModeOnBackspace", () => {
  test("Backspace exits on an empty command", () => {
    expect(shouldExitShellModeOnBackspace(key("Backspace"), { empty: true, caretAtEditorStart: false })).toBe(true);
  });

  test("Backspace with the caret at the editor start exits a non-empty command", () => {
    expect(shouldExitShellModeOnBackspace(key("Backspace"), { empty: false, caretAtEditorStart: true })).toBe(true);
  });

  test("Backspace mid-command keeps shell mode", () => {
    expect(shouldExitShellModeOnBackspace(key("Backspace"), { empty: false, caretAtEditorStart: false })).toBe(false);
  });

  test("modifier chords keep their own deletion semantics and never exit", () => {
    for (const modifier of ["shiftKey", "metaKey", "ctrlKey", "altKey"] as const) {
      expect(shouldExitShellModeOnBackspace(key("Backspace", { [modifier]: true }), { empty: false, caretAtEditorStart: true })).toBe(false);
    }
  });

  test("every other key leaves shell mode handling alone", () => {
    for (const other of ["!", "a", "Delete", "ArrowLeft", "Enter", " "]) {
      expect(shouldExitShellModeOnBackspace(key(other), { empty: false, caretAtEditorStart: true })).toBe(false);
    }
  });
});

describe("isCaretAtEditorStart", () => {
  test("collapsed caret at offset 0 of the first text node", () => {
    const root = editorWithText("ls -la");
    placeCaret(root.firstChild!, 0);
    expect(isCaretAtEditorStart(root)).toBe(true);
  });

  test("collapsed caret inside the command is not at the start", () => {
    const root = editorWithText("ls -la");
    placeCaret(root.firstChild!, 1);
    expect(isCaretAtEditorStart(root)).toBe(false);
  });

  test("a selection anchored at the start is not a caret", () => {
    const root = editorWithText("ls -la");
    placeCaret(root.firstChild!, 0, { node: root.firstChild!, offset: 3 });
    expect(isCaretAtEditorStart(root)).toBe(false);
  });

  test("caret at the start of a later line is not at the editor start", () => {
    const root = document.createElement("div");
    root.contentEditable = "true";
    const first = document.createTextNode("first");
    const br = document.createElement("br");
    const second = document.createTextNode("second");
    root.append(first, br, second);
    document.body.append(root);
    placeCaret(second, 0);
    expect(isCaretAtEditorStart(root)).toBe(false);
    placeCaret(first, 0);
    expect(isCaretAtEditorStart(root)).toBe(true);
  });

  test("caret on an empty editor is at the start", () => {
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.append(root);
    placeCaret(root, 0);
    expect(isCaretAtEditorStart(root)).toBe(true);
  });

  test("no selection is never the start", () => {
    const root = editorWithText("ls -la");
    expect(isCaretAtEditorStart(root)).toBe(false);
  });
});
