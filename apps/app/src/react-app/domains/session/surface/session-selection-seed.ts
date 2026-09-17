// Reconcile the app's per-session model/agent/variant memory with the
// runtime's per-session truth recorded on the OpenCode Session object
// (`session.agent`, `session.model`, `session.model.variant`).
//
// OpenCode records what actually ran for a session: a spawned subagent's
// subsession carries the subagent's own agent and model, and any session
// that has run carries the model it last used. The app's per-session stores
// are only written when the user sends in-app, so opening such a session
// used to fall back to the global default — showing an agent/model/variant
// that never ran there. This fills that gap by seeding the stores only when
// the session has no remembered override, so a user's explicit choice is
// never clobbered.
//
// The recorded agent is the resolved agent name: a session run with the
// app's "Default agent" picker resolves to the OpenWork default agent and is
// recorded as such, so it must not be materialized as a per-session override
// (that would flip the picker from "Default agent" to "Openwork").
import type { Session } from "@opencode-ai/sdk/v2/client";

import { DEFAULT_AGENT_NAME } from "@/app/constants";

import { getSessionAgent, useSessionAgentStore } from "./session-agent-store";
import {
  getSessionModelSelection,
  useSessionModelStore,
} from "./session-model-store";

export function seedSessionSelectionFromRuntime(session: Session): void {
  const sessionId = session.id;

  if (session.model?.providerID && session.model.id) {
    if (!getSessionModelSelection(sessionId)) {
      useSessionModelStore.getState().setModel(
        sessionId,
        { providerID: session.model.providerID, modelID: session.model.id },
        session.model.variant ?? null,
      );
    }
  }

  // Only remember a real (non-default) agent. The default agent is already
  // what an empty memory falls back to, so seeding it would surface "Openwork"
  // instead of the user's "Default agent" selection.
  if (session.agent?.trim() && session.agent !== DEFAULT_AGENT_NAME) {
    if (getSessionAgent(sessionId) === undefined) {
      useSessionAgentStore.getState().setAgent(sessionId, session.agent);
    }
  }
}
