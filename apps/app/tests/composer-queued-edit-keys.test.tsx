import { afterAll, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createRequire } from "node:module";
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

GlobalRegistrator.register({ url: "http://localhost/" });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
const network = mock(async () => { throw new Error("Network is not available in composer tests"); });
Object.defineProperty(globalThis, "fetch", { configurable: true, value: network });
Object.defineProperty(window, "fetch", { configurable: true, value: network });

const require = createRequire(import.meta.url);
for (const name of [
  "lexical",
  "@lexical/react/LexicalComposer.js",
  "@lexical/react/LexicalPlainTextPlugin.js",
  "@lexical/react/LexicalContentEditable.js",
  "@lexical/react/LexicalErrorBoundary.js",
  "@lexical/react/LexicalOnChangePlugin.js",
  "@lexical/react/LexicalHistoryPlugin.js",
  "@lexical/react/LexicalComposerContext.js",
]) {
  const exports = require(name);
  mock.module(name, () => exports);
}

const connections = {
  connections: [], loading: false, loaded: true, error: null, connectingId: null,
  refresh: async () => {}, connect: async () => {},
};
mock.module("@/components/model-select", () => ({ ModelSelect: () => null }));
mock.module("@/components/chat/image-lightbox", () => ({ ImageLightbox: () => null }));
mock.module("@/react-app/domains/connections/use-org-mcp-connections", () => ({ useOrgMcpConnections: () => connections }));
mock.module("@/react-app/domains/session/surface/composer/workspace-run-mode-menu", () => ({ WorkspaceRunModeMenu: () => null }));
mock.module("@/react-app/shell/dev-profiler", () => ({ DevProfiler: ({ children }: { children: ReactNode }) => children }));
mock.module("../src/react-app/domains/session/surface/composer/app-mentions", () => ({ listRunningAppsForMention: async () => [] }));

const { ReactSessionComposer } = await import("../src/react-app/domains/session/surface/composer/composer");
const { QueuedMessagesPanel } = await import("../src/react-app/domains/session/modals/queued-messages-panel");
const defaultAgents = [{ name: "openwork", mode: "primary", options: {}, permission: [] }];

const queuedText = "Queued first line\nQueued second line";
const queuedItem = {
  id: "queued-edit-keys",
  draft: {
    mode: "prompt" as const,
    text: queuedText,
    resolvedText: queuedText,
    parts: [{ type: "text" as const, text: queuedText }],
    attachments: [],
  },
};

async function mounted() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onStop = mock(() => {});
  let currentDraft = "";
  let currentMode: "prompt" | "shell" = "prompt";

  function Harness() {
    const [draft, setDraft] = useState(currentDraft);
    const [mode, setMode] = useState(currentMode);
    const updateDraft = (value: string) => { currentDraft = value; setDraft(value); };
    const updateMode = (value: "prompt" | "shell") => { currentMode = value; setMode(value); };
    return <ReactSessionComposer
      client={null}
      workspaceId={null}
      selectedModel={{ providerID: "fixture", modelID: "fixture" }}
      modelPickerOpen={false}
      onModelPickerOpenChange={() => {}}
      onModelChange={() => {}}
      modelVariantLabel="Default"
      modelVariant={null}
      onModelVariantChange={() => {}}
      agentLabel="OpenWork"
      selectedAgent={null}
      listAgents={async () => defaultAgents}
      onSelectAgent={() => {}}
      listCommands={async () => []}
      searchFiles={async () => []}
      isRemoteWorkspace={false}
      isSandboxWorkspace={false}
      draft={draft}
      mode={mode}
      onModeChange={updateMode}
      mentions={{}}
      onDraftChange={updateDraft}
      onSend={() => {}}
      onSteer={() => {}}
      onQueue={() => {}}
      onStop={onStop}
      busy={true}
      steering={false}
      submissionPreparing={false}
      queuedCount={1}
      disabled={false}
      statusLabel=""
      attachments={[]}
      onAttachFiles={() => {}}
      onRemoveAttachment={() => {}}
      attachmentsEnabled={false}
      attachmentsDisabledReason={null}
      recentFiles={[]}
      onInsertMention={() => {}}
      onPasteText={() => {}}
      onUnsupportedFileLinks={() => {}}
      pastedText={[]}
      onExpandPastedText={() => {}}
      onRemovePastedText={() => {}}
      inputHistory={[{ text: "Previous prompt", mode: "prompt" }]}
      topAccessory={
        <QueuedMessagesPanel
          items={[queuedItem]}
          onRemove={() => {}}
          onSendNow={() => {}}
          onReorder={() => {}}
          onEdit={() => {}}
        />
      }
    />;
  }

  await act(async () => root.render(<Harness />));
  const editor = container.querySelector<HTMLElement>('[contenteditable="true"][data-lexical-editor="true"]');
  if (!editor) throw new Error("Composer editor did not mount");

  const openQueuedEditor = async () => {
    const editButton = container.querySelector<HTMLButtonElement>('button[title="Edit queued message"]');
    if (!editButton) throw new Error("Queued message edit button did not render");
    await act(async () => editButton.click());
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit queued message"]');
    if (!textarea) throw new Error("Queued message editor did not open");
    textarea.focus();
    return textarea;
  };

  return {
    container,
    editor,
    openQueuedEditor,
    draft: () => currentDraft,
    onStop,
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("ArrowUp in a queued message editor keeps native caret behavior instead of recalling composer history", async () => {
  const composer = await mounted();
  try {
    const textarea = await composer.openQueuedEditor();
    textarea.setSelectionRange(queuedText.length, queuedText.length);
    const arrowUp = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    await act(async () => textarea.dispatchEvent(arrowUp));

    expect(arrowUp.defaultPrevented).toBe(false);
    expect(composer.draft()).toBe("");
    expect(composer.container.querySelector('[data-lexical-editor="true"]')?.textContent).toBe("");
    expect(composer.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit queued message"]')).toBe(textarea);

    const recall = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
    await act(async () => composer.editor.dispatchEvent(recall));

    expect(recall.defaultPrevented).toBe(true);
    expect(composer.draft()).toBe("Previous prompt");
  } finally { await composer.close(); }
});

test("Escape in a queued message editor cancels editing without arming the composer stop confirmation", async () => {
  const composer = await mounted();
  try {
    const textarea = await composer.openQueuedEditor();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => textarea.dispatchEvent(escape));

    expect(escape.defaultPrevented).toBe(true);
    expect(composer.container.querySelector("[data-composer-stop-confirmation]")).toBeNull();
    expect(composer.onStop).not.toHaveBeenCalled();
    expect(composer.container.querySelector('textarea[aria-label="Edit queued message"]')).toBeNull();
  } finally { await composer.close(); }
});

afterAll(() => GlobalRegistrator.unregister());
