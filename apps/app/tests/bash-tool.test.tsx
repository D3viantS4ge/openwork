/** @jsxImportSource react */
import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { BashTool } from "../src/components/tools/bash";
import type { BashToolPart } from "../src/lib/build-in-tools";

const runningPart: BashToolPart = {
  type: "dynamic-tool",
  toolName: "bash",
  toolCallId: "bash-running",
  state: "input-available",
  input: { command: "sleep 5 && echo hi", description: "Wait then greet" },
  metadata: { output: "partial output so far" },
};

const completedPart: BashToolPart = {
  type: "dynamic-tool",
  toolName: "bash",
  toolCallId: "bash-completed",
  state: "output-available",
  input: { command: "echo hi", description: "Greet" },
  output: "hi",
  metadata: { output: "hi", exit: 0 },
};

/** Renders inside a happy-dom document, cleaning up the root afterwards. */
async function withRoot(fn: (container: HTMLDivElement, root: ReturnType<typeof createRoot>) => Promise<void>) {
  const registeredDom = typeof globalThis.window === "undefined" || typeof globalThis.document === "undefined";
  if (registeredDom) GlobalRegistrator.register();
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await fn(container, root);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    if (registeredDom) await GlobalRegistrator.unregister();
  }
}

describe("BashTool live output", () => {
  test("a running command streams its metadata output tail with a running marker", async () => {
    await withRoot(async (container, root) => {
      await act(async () => root.render(<BashTool part={runningPart} />));

      expect(container.textContent).toContain("running…");
      expect(container.textContent).toContain("partial output so far");
      // No exit code exists while the command is still running.
      expect(container.textContent).not.toContain("exit");
    });
  });

  test("a running command without output yet renders no output block", async () => {
    const pending: BashToolPart = {
      ...runningPart,
      toolCallId: "bash-running-quiet",
      metadata: { output: "" },
    };

    await withRoot(async (container, root) => {
      await act(async () => root.render(<BashTool part={pending} />));

      expect(container.textContent).toContain("running…");
      expect(container.textContent).not.toContain("partial output so far");
    });
  });

  test("a completed command shows its exit code and final output, not the running marker", async () => {
    await withRoot(async (container, root) => {
      await act(async () => root.render(<BashTool part={completedPart} />));

      expect(container.textContent).toContain("exit 0");
      expect(container.textContent).toContain("hi");
      expect(container.textContent).not.toContain("running…");
    });
  });
});
