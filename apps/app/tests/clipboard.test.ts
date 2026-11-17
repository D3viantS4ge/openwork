import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { copyTextToClipboard } from "../src/lib/clipboard";

let ownedDom = false;
let previousClipboard: PropertyDescriptor | undefined;
let previousExecCommand: PropertyDescriptor | undefined;

beforeAll(async () => {
  if (typeof window === "undefined") {
    GlobalRegistrator.register({ url: "http://localhost/" });
    ownedDom = true;
  }
});

afterAll(async () => {
  if (ownedDom) await GlobalRegistrator.unregister();
});

afterEach(() => {
  if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  previousClipboard = undefined;

  if (previousExecCommand) Object.defineProperty(document, "execCommand", previousExecCommand);
  else Reflect.deleteProperty(document, "execCommand");
  previousExecCommand = undefined;
});

function stubClipboard(value: unknown) {
  if (previousClipboard === undefined) {
    previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  }
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

function stubExecCommand(implementation: (command: string) => boolean) {
  if (previousExecCommand === undefined) {
    previousExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
  }
  Object.defineProperty(document, "execCommand", { configurable: true, value: implementation });
}

describe("copyTextToClipboard", () => {
  test("uses the async Clipboard API when it is available", async () => {
    const writes: string[] = [];
    stubClipboard({
      writeText: async (text: string) => {
        writes.push(text);
      },
    });

    await expect(copyTextToClipboard("hello")).resolves.toBe(true);
    expect(writes).toEqual(["hello"]);
  });

  test("falls back to execCommand when the Clipboard API is unavailable", async () => {
    stubClipboard(undefined);
    let selectedText = "";
    const commands: string[] = [];
    stubExecCommand((command) => {
      commands.push(command);
      selectedText = document.activeElement instanceof HTMLTextAreaElement
        ? document.activeElement.value
        : "";
      return true;
    });

    await expect(copyTextToClipboard("fallback text")).resolves.toBe(true);
    expect(commands).toEqual(["copy"]);
    expect(selectedText).toBe("fallback text");
    expect(document.querySelector("textarea")).toBeNull();
  });

  test("uses the fallback directly in an insecure context", async () => {
    const previousSecureContext = Object.getOwnPropertyDescriptor(window, "isSecureContext");
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    try {
      const writes: string[] = [];
      stubClipboard({
        writeText: async (text: string) => {
          writes.push(text);
        },
      });
      const commands: string[] = [];
      stubExecCommand((command) => {
        commands.push(command);
        return true;
      });

      await expect(copyTextToClipboard("insecure")).resolves.toBe(true);
      expect(writes).toEqual([]);
      expect(commands).toEqual(["copy"]);
    } finally {
      if (previousSecureContext) Object.defineProperty(window, "isSecureContext", previousSecureContext);
      else Reflect.deleteProperty(window, "isSecureContext");
    }
  });

  test("falls back to execCommand when the Clipboard API rejects", async () => {
    stubClipboard({
      writeText: async () => {
        throw new Error("denied");
      },
    });
    const commands: string[] = [];
    stubExecCommand((command) => {
      commands.push(command);
      return true;
    });

    await expect(copyTextToClipboard("rejected")).resolves.toBe(true);
    expect(commands).toEqual(["copy"]);
  });

  test("restores focus after the fallback copy", async () => {
    stubClipboard(undefined);
    stubExecCommand(() => true);
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();

    try {
      await expect(copyTextToClipboard("focus")).resolves.toBe(true);
      expect(document.activeElement).toBe(button);
    } finally {
      button.remove();
    }
  });

  test("returns false when neither copy path succeeds", async () => {
    stubClipboard(undefined);
    await expect(copyTextToClipboard("no execCommand")).resolves.toBe(false);

    stubExecCommand(() => false);
    await expect(copyTextToClipboard("refused")).resolves.toBe(false);

    stubExecCommand(() => {
      throw new Error("blocked");
    });
    await expect(copyTextToClipboard("threw")).resolves.toBe(false);
  });
});
