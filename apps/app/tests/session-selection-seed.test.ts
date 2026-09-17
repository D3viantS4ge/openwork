import { afterEach, describe, expect, test } from "bun:test";
import type { Session } from "@opencode-ai/sdk/v2/client";

import type { OpenworkSessionSnapshot } from "../src/app/lib/openwork-server";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { getSessionAgent, useSessionAgentStore } from "../src/react-app/domains/session/surface/session-agent-store";
import {
  getSessionModelSelection,
  useSessionModelStore,
} from "../src/react-app/domains/session/surface/session-model-store";
import { seedSessionSelectionFromRuntime } from "../src/react-app/domains/session/surface/session-selection-seed";
import { seedSessionState } from "../src/react-app/domains/session/sync/session-sync";

const workspaceId = "workspace-seed-test";
const sessionId = "session-seed-test";

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: sessionId,
    slug: sessionId,
    projectID: "project-seed-test",
    directory: "/tmp/project-seed-test",
    title: "Seed test",
    version: "1",
    time: { created: 1, updated: 1 },
    ...overrides,
  };
}

function createSnapshot(session: Session): OpenworkSessionSnapshot {
  return {
    session,
    messages: [],
    todos: [],
    status: { type: "idle" },
  };
}

function clearSelections() {
  useSessionModelStore.setState({ bySessionId: {} });
  useSessionAgentStore.setState({ bySessionId: {} });
}

afterEach(() => {
  clearSelections();
  getReactQueryClient().clear();
});

describe("seedSessionSelectionFromRuntime", () => {
  test("seeds model, variant, and agent from a subsession's runtime session info", () => {
    seedSessionSelectionFromRuntime(createSession({
      parentID: "parent-session",
      agent: "explorer",
      model: { providerID: "openai", id: "gpt-5", variant: "high" },
    }));

    expect(getSessionModelSelection(sessionId)).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "high",
    });
    expect(getSessionAgent(sessionId)).toBe("explorer");
  });

  test("does not clobber an existing model or agent override", () => {
    useSessionModelStore.getState().setModel(sessionId, { providerID: "anthropic", modelID: "claude" }, "low");
    useSessionAgentStore.getState().setAgent(sessionId, "build");

    seedSessionSelectionFromRuntime(createSession({
      parentID: "parent-session",
      agent: "explorer",
      model: { providerID: "openai", id: "gpt-5", variant: "high" },
    }));

    expect(getSessionModelSelection(sessionId)).toEqual({
      model: { providerID: "anthropic", modelID: "claude" },
      variant: "low",
    });
    expect(getSessionAgent(sessionId)).toBe("build");
  });

  test("keeps the model override while seeding the missing agent", () => {
    useSessionModelStore.getState().setModel(sessionId, { providerID: "anthropic", modelID: "claude" }, null);

    seedSessionSelectionFromRuntime(createSession({
      parentID: "parent-session",
      agent: "explorer",
      model: { providerID: "openai", id: "gpt-5" },
    }));

    expect(getSessionModelSelection(sessionId)).toEqual({
      model: { providerID: "anthropic", modelID: "claude" },
      variant: null,
    });
    expect(getSessionAgent(sessionId)).toBe("explorer");
  });

  test("ignores an empty or missing model and agent", () => {
    seedSessionSelectionFromRuntime(createSession({
      parentID: "parent-session",
      agent: "  ",
      model: { providerID: "", id: "" },
    }));

    expect(getSessionModelSelection(sessionId)).toBeNull();
    expect(getSessionAgent(sessionId)).toBeUndefined();
  });

  test("does not seed the per-session agent when the runtime recorded the default agent", () => {
    seedSessionSelectionFromRuntime(createSession({
      parentID: "parent-session",
      agent: "openwork",
      model: { providerID: "openai", id: "gpt-5" },
    }));

    // The default agent is already what an empty memory falls back to, so
    // materializing it would flip the picker from "Default agent" to "Openwork".
    expect(getSessionModelSelection(sessionId)).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: null,
    });
    expect(getSessionAgent(sessionId)).toBeUndefined();
  });
});

describe("seedSessionState gate", () => {
  test("seeds the per-session selection when the snapshot belongs to a subsession", () => {
    seedSessionState(workspaceId, createSnapshot(createSession({
      parentID: "parent-session",
      agent: "general",
      model: { providerID: "openai", id: "gpt-5", variant: "high" },
    })));

    expect(getSessionModelSelection(sessionId)).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: "high",
    });
    expect(getSessionAgent(sessionId)).toBe("general");
  });

  test("seeds a top-level session from its runtime agent/model when there is no override", () => {
    seedSessionState(workspaceId, createSnapshot(createSession({
      agent: "build",
      model: { providerID: "openai", id: "gpt-5" },
    })));

    expect(getSessionModelSelection(sessionId)).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: null,
    });
    expect(getSessionAgent(sessionId)).toBe("build");
  });

  test("does not flip a top-level session to the default agent after a run", () => {
    seedSessionState(workspaceId, createSnapshot(createSession({
      agent: "openwork",
      model: { providerID: "openai", id: "gpt-5" },
    })));

    // Reproduces the regression: a new session run with "Default agent"
    // records "openwork" and previously flipped the agent picker.
    expect(getSessionModelSelection(sessionId)).toEqual({
      model: { providerID: "openai", modelID: "gpt-5" },
      variant: null,
    });
    expect(getSessionAgent(sessionId)).toBeUndefined();
  });
});
