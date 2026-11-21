/** @jsxImportSource react */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";

import {
  getSessionAgentSelection,
  isSessionAgentAdopted,
  readSessionAgentAdoptions,
  readSessionAgentSelections,
  useSessionAgentSelection,
  useSessionAgentStore,
} from "../src/react-app/domains/session/surface/session-mode-memory";

const storageKey = "openwork.sessionAgents.v1";
const adoptedStorageKey = "openwork.sessionAgents.adopted.v1";
const registeredDom = typeof window === "undefined";

beforeAll(() => {
  if (registeredDom) GlobalRegistrator.register({ url: "http://localhost/" });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
});

afterAll(async () => {
  if (registeredDom) await GlobalRegistrator.unregister();
});

beforeEach(() => {
  window.localStorage.removeItem(storageKey);
  window.localStorage.removeItem(adoptedStorageKey);
  useSessionAgentStore.setState({ bySessionId: {}, adoptedBySessionId: {} });
});

describe("session mode memory", () => {
  test("remembers independent choices and explicit Default across reload", () => {
    const { setAgent } = useSessionAgentStore.getState();
    setAgent("session-a", "plan");
    setAgent("session-b", "build");
    setAgent("session-a", null);

    const stored = readSessionAgentSelections();
    const adopted = readSessionAgentAdoptions();
    useSessionAgentStore.setState({ bySessionId: {}, adoptedBySessionId: {} });
    useSessionAgentStore.setState({ bySessionId: stored, adoptedBySessionId: adopted });

    expect(getSessionAgentSelection("session-a", "plan")).toBeNull();
    expect(getSessionAgentSelection("session-b", "plan")).toBe("build");
    expect(getSessionAgentSelection("unknown", "plan")).toBe("plan");
    expect(stored).toEqual({ "session-b": "build", "session-a": null });
  });

  test("ignores malformed storage and invalid entries without losing valid choices", () => {
    for (const raw of ["{", "null", "[]", "1", '"plan"']) {
      window.localStorage.setItem(storageKey, raw);
      expect(readSessionAgentSelections()).toEqual({});
    }
    window.localStorage.setItem(storageKey, JSON.stringify({
      valid: "plan", custom: "review", default: null, "": "build",
      object: { agent: "build" }, array: ["build"], number: 1, blank: " ", boolean: true,
    }));
    expect(readSessionAgentSelections()).toEqual({ valid: "plan", custom: "review", default: null });
    window.localStorage.removeItem(storageKey);
    expect(readSessionAgentSelections()).toEqual({});
  });

  test("tracks auto-adopted values separately from explicit choices", () => {
    const store = useSessionAgentStore.getState();
    store.adoptAgent("session-a", "plan");
    expect(getSessionAgentSelection("session-a")).toBe("plan");
    expect(isSessionAgentAdopted("session-a")).toBe(true);

    store.adoptAgent("session-b", null);
    expect(getSessionAgentSelection("session-b", "plan")).toBeNull();
    expect(isSessionAgentAdopted("session-b")).toBe(true);

    // Re-selecting the same value is a deliberate choice, not adoption.
    store.setAgent("session-a", "plan");
    expect(isSessionAgentAdopted("session-a")).toBe(false);
    store.setAgent("session-c", "build");
    expect(isSessionAgentAdopted("session-c")).toBe(false);
  });

  test("does not adopt over an explicit selection", () => {
    const store = useSessionAgentStore.getState();
    store.setAgent("session-a", "plan");
    store.adoptAgent("session-a", "build");
    expect(getSessionAgentSelection("session-a")).toBe("plan");
    expect(isSessionAgentAdopted("session-a")).toBe(false);
  });

  test("persists adoption markers and drops them after an explicit choice", () => {
    useSessionAgentStore.getState().adoptAgent("session-a", "plan");
    expect(readSessionAgentAdoptions()).toEqual({ "session-a": true });

    const stored = readSessionAgentSelections();
    const adopted = readSessionAgentAdoptions();
    useSessionAgentStore.setState({ bySessionId: {}, adoptedBySessionId: {} });
    useSessionAgentStore.setState({ bySessionId: stored, adoptedBySessionId: adopted });
    expect(isSessionAgentAdopted("session-a")).toBe(true);

    useSessionAgentStore.getState().setAgent("session-a", "plan");
    expect(readSessionAgentAdoptions()).toEqual({});
  });

  test("ignores malformed adoption storage", () => {
    for (const raw of ["{}", "null", "1", '"plan"', "[1, null]"]) {
      window.localStorage.setItem(adoptedStorageKey, raw);
      expect(readSessionAgentAdoptions()).toEqual({});
    }
    window.localStorage.setItem(adoptedStorageKey, JSON.stringify(["valid", "", " ", 1, null]));
    expect(readSessionAgentAdoptions()).toEqual({ valid: true });
  });

  test("keeps memory usable when storage reads, writes, or access fail", () => {
    const read = spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("unavailable"); });
    try {
      expect(readSessionAgentSelections()).toEqual({});
      expect(readSessionAgentAdoptions()).toEqual({});
    } finally {
      read.mockRestore();
    }

    const write = spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("full"); });
    try {
      useSessionAgentStore.getState().setAgent("session-a", "plan");
      expect(getSessionAgentSelection("session-a")).toBe("plan");
      useSessionAgentStore.getState().adoptAgent("session-b", "build");
      expect(getSessionAgentSelection("session-b")).toBe("build");
      expect(isSessionAgentAdopted("session-b")).toBe(true);
      useSessionAgentStore.getState().setAgent("session-b", "plan");
      expect(isSessionAgentAdopted("session-b")).toBe(false);
    } finally {
      write.mockRestore();
    }

    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    try {
      Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("denied"); } });
      expect(readSessionAgentSelections()).toEqual({});
      expect(readSessionAgentAdoptions()).toEqual({});
      useSessionAgentStore.getState().setAgent("session-a", null);
      expect(getSessionAgentSelection("session-a", "plan")).toBeNull();
      useSessionAgentStore.getState().adoptAgent("session-c", "build");
      expect(isSessionAgentAdopted("session-c")).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
      else Reflect.deleteProperty(window, "localStorage");
    }
  });

  test("works without a browser window", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    if (!descriptor) throw new Error("Expected a window descriptor");
    try {
      Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });
      expect(readSessionAgentSelections()).toEqual({});
      expect(readSessionAgentAdoptions()).toEqual({});
      useSessionAgentStore.getState().setAgent("session-a", "plan");
      expect(getSessionAgentSelection("session-a")).toBe("plan");
      useSessionAgentStore.getState().adoptAgent("session-b", "build");
      expect(isSessionAgentAdopted("session-b")).toBe(true);
    } finally {
      Object.defineProperty(globalThis, "window", descriptor);
    }
  });

  test("caps loaded and updated memory at 200 sessions and skips unchanged selections", () => {
    const entries = Array.from({ length: 201 }, (_, index) => [`session-${index}`, "build"]);
    window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
    const stored = readSessionAgentSelections();
    expect(Object.keys(stored)).toHaveLength(200);
    expect(stored["session-0"]).toBeUndefined();
    useSessionAgentStore.setState({ bySessionId: stored, adoptedBySessionId: {} });

    const before = useSessionAgentStore.getState();
    before.setAgent("session-1", "build");
    expect(useSessionAgentStore.getState()).toBe(before);
    before.setAgent("session-1", "plan");
    before.setAgent("session-201", null);

    const after = readSessionAgentSelections();
    expect(Object.keys(after)).toHaveLength(200);
    expect(after["session-1"]).toBe("plan");
    expect(after["session-2"]).toBeUndefined();
    expect(after["session-201"]).toBeNull();
  });

  test("caps adoption markers alongside remembered selections", () => {
    for (let index = 0; index < 201; index += 1) {
      useSessionAgentStore.getState().adoptAgent(`session-${index}`, "build");
    }
    const stored = readSessionAgentSelections();
    const adopted = readSessionAgentAdoptions();
    expect(Object.keys(stored)).toHaveLength(200);
    expect(Object.keys(adopted)).toHaveLength(200);
    expect(stored["session-0"]).toBeUndefined();
    expect(adopted["session-0"]).toBeUndefined();
    expect(adopted["session-200"]).toBe(true);
  });

  test("hooks isolate panes, retain selection callbacks, and keep the new-task preference separate", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const controls = new Map<string, ReturnType<typeof useSessionAgentSelection>>();
    const changeDefault = mock((_agent: string | null) => {});
    let fallbackAgent: string | null = "build";
    function Pane({ name, sessionId }: { name: string; sessionId: string | null }) {
      const selection = useSessionAgentSelection({ sessionId, fallbackAgent, onFallbackAgentChange: changeDefault });
      controls.set(name, selection);
      return <output data-pane={name}>{selection.selectedAgent ?? "default"}</output>;
    }
    const render = async (leftSession = "session-a") => {
      await act(async () => root.render(<>
        <Pane name="left" sessionId={leftSession} />
        <Pane name="right" sessionId="session-b" />
        <Pane name="new" sessionId={null} />
      </>));
    };
    const choice = (name: string) => {
      const selection = controls.get(name);
      if (!selection) throw new Error(`Missing ${name} controls`);
      return selection;
    };

    try {
      await render();
      const selectA = choice("left").setAgent;
      await act(async () => {
        selectA("plan");
        choice("right").setAgent(null);
      });
      expect(choice("left").selectedAgent).toBe("plan");
      expect(choice("right").selectedAgent).toBeNull();
      expect(choice("new").selectedAgent).toBe("build");
      expect(changeDefault).not.toHaveBeenCalled();

      await render("session-b");
      await act(async () => selectA("build"));
      expect(choice("left").selectedAgent).toBeNull();
      expect(getSessionAgentSelection("session-a")).toBe("build");
      await act(async () => choice("new").setAgent("plan"));
      expect(changeDefault).toHaveBeenCalledWith("plan");
      fallbackAgent = "plan";
      await render();
      expect(choice("left").selectedAgent).toBe("build");
      expect(choice("right").selectedAgent).toBeNull();
      expect(choice("new").selectedAgent).toBe("plan");

      // A newly seeded session must not re-adopt a newer global preference on mount.
      useSessionAgentStore.getState().setAgent("session-new", fallbackAgent);
      fallbackAgent = "build";
      await render("session-new");
      expect(choice("left").selectedAgent).toBe("plan");
      expect(choice("right").selectedAgent).toBeNull();

      const stored = readSessionAgentSelections();
      const adopted = readSessionAgentAdoptions();
      await act(async () => root.render(null));
      useSessionAgentStore.setState({ bySessionId: stored, adoptedBySessionId: adopted });
      await render("session-new");
      expect(choice("left").selectedAgent).toBe("plan");
      expect(choice("right").selectedAgent).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
