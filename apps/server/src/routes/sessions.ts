import type { createOpencodeClient, Session } from "@opencode-ai/sdk/v2/client";
import { ApiError } from "../errors.js";
import { buildSession, buildSessionList, buildSessionMessages, buildSessionSnapshot } from "../session-read-model.js";
import {
  createSessionGroupId,
  normalizeSessionGroupState,
  readSessionGroupState,
  SessionGroupEventStore,
  updateSessionGroupState,
  type SessionGroupDefinition,
  type SessionGroupState,
} from "../session-groups.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ParseOptionalBoolean = (value: string | null, name: string) => boolean | undefined;
type ParseOptionalPositiveInteger = (value: string | null, name: string) => number | undefined;
type ParseOptionalNonNegativeInteger = (value: string | null, name: string) => number | undefined;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;
type WorkspaceOpencodeClient = ReturnType<typeof createOpencodeClient>;
type OpencodeClientResult<T, E> =
  | { data: T | undefined; error: undefined; response: Response }
  | { data: undefined; error: E; response?: Response };
type UnwrapOpencodeResult = <T, E>(result: OpencodeClientResult<T, E>, path: string) => NonNullable<T>;

interface RegisterSessionRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  parseOptionalBoolean: ParseOptionalBoolean;
  parseOptionalPositiveInteger: ParseOptionalPositiveInteger;
  parseOptionalNonNegativeInteger: ParseOptionalNonNegativeInteger;
  readJsonBody: ReadJsonBody;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  resolveWorkspaceWithoutBootstrap: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  createWorkspaceOpencodeClient: (
    config: ServerConfig,
    workspace: WorkspaceInfo,
    options?: { boundedDiagnosticsReads?: boolean; sessionId?: string },
  ) => WorkspaceOpencodeClient;
  unwrapOpencodeResult: UnwrapOpencodeResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function registerSessionRoutes(options: RegisterSessionRoutesOptions): void {
  const {
    routes,
    config,
    jsonResponse,
    parseOptionalBoolean,
    parseOptionalPositiveInteger,
    parseOptionalNonNegativeInteger,
    readJsonBody,
    ensureWritable,
    requireClientScope,
    resolveWorkspace,
    resolveWorkspaceWithoutBootstrap,
    createWorkspaceOpencodeClient,
    unwrapOpencodeResult,
  } = options;
  const sessionGroupEvents = new SessionGroupEventStore();

  function remapSessionReadError(error: unknown): never {
    if (error instanceof ApiError && error.code === "opencode_request_failed") {
      const details = error.details;
      const upstreamStatus =
        isRecord(details) && "status" in details ? Number(details.status) : NaN;
      if (upstreamStatus === 400) {
        throw new ApiError(400, "invalid_query", "OpenCode rejected the session read request", details);
      }
      if (upstreamStatus === 404) {
        throw new ApiError(404, "session_not_found", "Session not found", details);
      }
    }
    throw error;
  }

  // Subagents run in their own engine sessions (fresh session per Task call),
  // so the parent session's cost/tokens exclude all downstream usage. The
  // engine only reports per-session usage and its `children` query is
  // single-level, so we roll up descendants recursively here. The rollup is
  // best-effort: engines without the children route keep parent-only usage.
  const SUBAGENT_USAGE_DEPTH_LIMIT = 8;
  const rolledUpUsageWarned = new Set<string>();

  type SessionUsageAccumulator = {
    cost: number;
    tokens: {
      input: number;
      output: number;
      reasoning: number;
      cacheRead: number;
      cacheWrite: number;
    };
  };

  function emptySessionUsage(): SessionUsageAccumulator {
    return { cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } };
  }

  function accumulateSessionUsage(accumulator: SessionUsageAccumulator, session: Session): void {
    if (typeof session.cost === "number") accumulator.cost += session.cost;
    const tokens = session.tokens;
    if (!tokens) return;
    accumulator.tokens.input += tokens.input;
    accumulator.tokens.output += tokens.output;
    accumulator.tokens.reasoning += tokens.reasoning;
    accumulator.tokens.cacheRead += tokens.cache.read;
    accumulator.tokens.cacheWrite += tokens.cache.write;
  }

  function mergeUsage(total: SessionUsageAccumulator, part: SessionUsageAccumulator): void {
    total.cost += part.cost;
    total.tokens.input += part.tokens.input;
    total.tokens.output += part.tokens.output;
    total.tokens.reasoning += part.tokens.reasoning;
    total.tokens.cacheRead += part.tokens.cacheRead;
    total.tokens.cacheWrite += part.tokens.cacheWrite;
  }

  function applySubagentUsage(session: Session, usage: SessionUsageAccumulator): void {
    if (
      usage.cost <= 0 &&
      usage.tokens.input <= 0 &&
      usage.tokens.output <= 0 &&
      usage.tokens.reasoning <= 0 &&
      usage.tokens.cacheRead <= 0 &&
      usage.tokens.cacheWrite <= 0
    ) {
      return;
    }
    const tokens = session.tokens;
    session.cost = (typeof session.cost === "number" ? session.cost : 0) + usage.cost;
    session.tokens = {
      input: (tokens?.input ?? 0) + usage.tokens.input,
      output: (tokens?.output ?? 0) + usage.tokens.output,
      reasoning: (tokens?.reasoning ?? 0) + usage.tokens.reasoning,
      cache: {
        read: (tokens?.cache?.read ?? 0) + usage.tokens.cacheRead,
        write: (tokens?.cache?.write ?? 0) + usage.tokens.cacheWrite,
      },
    };
  }

  async function fetchSessionChildren(
    opencode: WorkspaceOpencodeClient,
    sessionId: string,
  ): Promise<Session[]> {
    try {
      return unwrapOpencodeResult(
        await opencode.session.children({ sessionID: sessionId }),
        `/session/${encodeURIComponent(sessionId)}/children`,
      );
    } catch (error) {
      if (!rolledUpUsageWarned.has(sessionId)) {
        rolledUpUsageWarned.add(sessionId);
        console.warn(
          `[sessions] subagent usage rollup unavailable for ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return [];
    }
  }

  async function collectDescendantUsage(
    opencode: WorkspaceOpencodeClient,
    sessionId: string,
    depth: number,
    visited: Set<string>,
  ): Promise<SessionUsageAccumulator> {
    if (depth > SUBAGENT_USAGE_DEPTH_LIMIT || visited.has(sessionId)) return emptySessionUsage();
    visited.add(sessionId);
    const children = await fetchSessionChildren(opencode, sessionId);
    const grandchildUsages = await Promise.all(
      children.map((child) => collectDescendantUsage(opencode, child.id, depth + 1, visited)),
    );
    const usage = emptySessionUsage();
    for (let index = 0; index < children.length; index++) {
      const child = children[index];
      const grandchildUsage = grandchildUsages[index];
      if (!child || !grandchildUsage) continue;
      accumulateSessionUsage(usage, child);
      mergeUsage(usage, grandchildUsage);
    }
    return usage;
  }

  async function listWorkspaceSessions(
    workspace: WorkspaceInfo,
    input: { roots?: boolean; start?: number; search?: string; limit?: number },
  ) {
    try {
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      return buildSessionList(
        unwrapOpencodeResult(
          await opencode.session.list({
            roots: input.roots,
            start: input.start,
            search: input.search,
            limit: input.limit,
          }),
          "/session",
        ),
      );
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  async function createWorkspaceSession(
    workspace: WorkspaceInfo,
    input: { title: string; prompt?: string; providerId?: string; modelId?: string; variant?: string },
  ) {
    const opencode = createWorkspaceOpencodeClient(config, workspace);
    const session = buildSession(
      unwrapOpencodeResult(
        await opencode.session.create({ title: input.title }),
        "/session",
      ),
    );

    if (input.prompt) {
      const result = await opencode.session.promptAsync({
        sessionID: session.id,
        ...(input.providerId && input.modelId
          ? { model: { providerID: input.providerId, modelID: input.modelId } }
          : {}),
        ...(input.variant ? { variant: input.variant } : {}),
        parts: [{ type: "text", text: input.prompt }],
      });
      if (result.error !== undefined) {
        const upstreamStatus = result.response?.status;
        throw new ApiError(502, "opencode_request_failed", "OpenCode request failed", {
          ...(upstreamStatus === undefined ? {} : { status: upstreamStatus }),
          body: result.error,
          path: `/session/${encodeURIComponent(session.id)}/prompt_async`,
        });
      }
    }

    return { item: session, started: Boolean(input.prompt) };
  }

  async function readWorkspaceSession(workspace: WorkspaceInfo, sessionId: string) {
    try {
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      return buildSession(
        unwrapOpencodeResult(
          await opencode.session.get({ sessionID: sessionId }),
          `/session/${encodeURIComponent(sessionId)}`,
        ),
      );
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  async function readWorkspaceSessionMessages(
    workspace: WorkspaceInfo,
    sessionId: string,
    input: { limit?: number },
  ) {
    try {
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      return buildSessionMessages(
        unwrapOpencodeResult(
          await opencode.session.messages({ sessionID: sessionId, limit: input.limit }),
          `/session/${encodeURIComponent(sessionId)}/message`,
        ),
      );
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  async function readWorkspaceSessionSnapshot(
    workspace: WorkspaceInfo,
    sessionId: string,
    input: { limit?: number },
  ) {
    try {
      const opencode = createWorkspaceOpencodeClient(config, workspace);
      const [session, messages, todos, statuses] = await Promise.all([
        opencode.session
          .get({ sessionID: sessionId })
          .then((result) => unwrapOpencodeResult(result, `/session/${encodeURIComponent(sessionId)}`)),
        opencode.session
          .messages({ sessionID: sessionId, limit: input.limit })
          .then((result) => unwrapOpencodeResult(result, `/session/${encodeURIComponent(sessionId)}/message`)),
        opencode.session
          .todo({ sessionID: sessionId })
          .then((result) => unwrapOpencodeResult(result, `/session/${encodeURIComponent(sessionId)}/todo`)),
        opencode.session.status().then((result) => unwrapOpencodeResult(result, "/session/status")),
      ]);
      // Subagents spend tokens in their own sessions; fold their usage into
      // the parent record so the token bar shows the full cost of the run.
      const descendantUsage = await collectDescendantUsage(opencode, sessionId, 0, new Set());
      applySubagentUsage(session, descendantUsage);
      return buildSessionSnapshot({ session, messages, todos, statuses });
    } catch (error) {
      remapSessionReadError(error);
    }
  }

  async function updateWorkspaceSessionGroups(
    workspaceId: string,
    updater: (current: SessionGroupState) => SessionGroupState,
  ) {
    return updateSessionGroupState(config, workspaceId, updater);
  }

  function requireStringField(body: Record<string, unknown>, field: string): string {
    const value = body[field];
    if (typeof value !== "string" || !value.trim()) {
      throw new ApiError(400, "invalid_payload", `${field} is required`);
    }
    return value.trim();
  }

  function optionalStringField(body: Record<string, unknown>, field: string): string | undefined {
    const value = body[field];
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" || !value.trim()) {
      throw new ApiError(400, "invalid_payload", `${field} must be a non-empty string`);
    }
    return value.trim();
  }

  function optionalBooleanField(body: Record<string, unknown>, field: string): boolean | undefined {
    const value = body[field];
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
      throw new ApiError(400, "invalid_payload", `${field} must be a boolean`);
    }
    return value;
  }

  addRoute(routes, "POST", "/workspace/:id/sessions", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const title = requireStringField(body, "title");
    if (title.length > 120) {
      throw new ApiError(400, "invalid_payload", "title must be 120 characters or fewer");
    }
    const prompt = optionalStringField(body, "prompt");
    const providerId = optionalStringField(body, "providerId");
    const modelId = optionalStringField(body, "modelId");
    const variant = optionalStringField(body, "variant");
    if (Boolean(providerId) !== Boolean(modelId)) {
      throw new ApiError(400, "invalid_payload", "providerId and modelId must be provided together");
    }
    if (prompt && prompt.length > 100_000) {
      throw new ApiError(400, "invalid_payload", "prompt must be 100000 characters or fewer");
    }
    const result = await createWorkspaceSession(workspace, {
      title,
      ...(prompt ? { prompt } : {}),
      ...(providerId && modelId ? { providerId, modelId } : {}),
      ...(variant ? { variant } : {}),
    });
    return jsonResponse(result, 201);
  });

  addRoute(routes, "PATCH", "/workspace/:id/sessions/:sessionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) throw new ApiError(400, "invalid_payload", "sessionId is required");
    const body = await readJsonBody(ctx.request);
    const title = optionalStringField(body, "title");
    const archived = optionalBooleanField(body, "archived");
    if (title === undefined && archived === undefined) {
      throw new ApiError(400, "invalid_payload", "title or archived is required");
    }
    if (title !== undefined && title.length > 120) {
      throw new ApiError(400, "invalid_payload", "title must be 120 characters or fewer");
    }
    const opencode = createWorkspaceOpencodeClient(config, workspace);
    const session = buildSession(
      unwrapOpencodeResult(
        await opencode.session.update({
          sessionID: sessionId,
          ...(title !== undefined ? { title } : {}),
          ...(archived !== undefined ? { time: { archived: archived ? Date.now() : 0 } } : {}),
        }),
        `/session/${encodeURIComponent(sessionId)}`,
      ),
    );
    return jsonResponse({ item: session });
  });

  addRoute(routes, "POST", "/workspace/:id/sessions/:sessionId/abort", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = ctx.params.sessionId?.trim();
    if (!sessionId) throw new ApiError(400, "invalid_payload", "sessionId is required");
    console.info("[openwork-server] abort", {
      phase: "start",
      source: "workspace.sessions.abort_route",
      initiator: "user",
      reason: "client requested session abort through OpenWork server route",
      workspaceId: workspace.id,
      sessionID: sessionId,
      actorType: ctx.actor?.type ?? "unknown",
    });
    const result = await createWorkspaceOpencodeClient(config, workspace, { sessionId }).session.abort({ sessionID: sessionId });
    if (result.error !== undefined) {
      console.info("[openwork-server] abort", {
        phase: "error",
        source: "workspace.sessions.abort_route",
        initiator: "user",
        workspaceId: workspace.id,
        sessionID: sessionId,
        actorType: ctx.actor?.type ?? "unknown",
      });
      throw new ApiError(502, "opencode_request_failed", "OpenCode abort failed");
    }
    console.info("[openwork-server] abort", {
      phase: "done",
      source: "workspace.sessions.abort_route",
      initiator: "user",
      workspaceId: workspace.id,
      sessionID: sessionId,
      actorType: ctx.actor?.type ?? "unknown",
    });
    return jsonResponse({ ok: true });
  });

  addRoute(routes, "GET", "/workspace/:id/sessions", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const items = await listWorkspaceSessions(workspace, {
      roots: parseOptionalBoolean(ctx.url.searchParams.get("roots"), "roots"),
      start: parseOptionalNonNegativeInteger(ctx.url.searchParams.get("start"), "start"),
      search: ctx.url.searchParams.get("search")?.trim() || undefined,
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    });
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/session-groups", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    const result = await readSessionGroupState(config, workspace.id);
    return jsonResponse({ state: result.state, updatedAt: result.updatedAt });
  });

  addRoute(routes, "PUT", "/workspace/:id/session-groups", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const state = normalizeSessionGroupState(body.state);
    const result = await updateWorkspaceSessionGroups(workspace.id, () => state);
    sessionGroupEvents.record(workspace.id, "imported");
    return jsonResponse({ state: result.state, updatedAt: result.updatedAt });
  });

  addRoute(routes, "POST", "/workspace/:id/session-groups", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const label = requireStringField(body, "label").slice(0, 120);
    const requestedId = typeof body.id === "string" ? body.id.trim().slice(0, 128) : "";
    const result = await updateWorkspaceSessionGroups(workspace.id, (current) => {
      const existingIds = new Set(current.groups.map((group) => group.id));
      const id = requestedId && !existingIds.has(requestedId) ? requestedId : createSessionGroupId();
      return { ...current, groups: [...current.groups, { id, label }] };
    });
    const groupId = result.state.groups[result.state.groups.length - 1]?.id;
    sessionGroupEvents.record(workspace.id, "created", groupId ? { groupId } : undefined);
    return jsonResponse({ state: result.state, updatedAt: result.updatedAt });
  });

  addRoute(routes, "PATCH", "/workspace/:id/session-groups/reorder", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const body = await readJsonBody(ctx.request);
    const requestedIds = Array.isArray(body.groupIds)
      ? body.groupIds.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [];
    const result = await updateWorkspaceSessionGroups(workspace.id, (current) => {
      const byId = new Map(current.groups.map((group) => [group.id, group]));
      const used = new Set<string>();
      const groups: SessionGroupDefinition[] = [];
      for (const id of requestedIds) {
        const group = byId.get(id);
        if (!group || used.has(id)) continue;
        groups.push(group);
        used.add(id);
      }
      for (const group of current.groups) {
        if (!used.has(group.id)) groups.push(group);
      }
      return { ...current, groups };
    });
    sessionGroupEvents.record(workspace.id, "reordered");
    return jsonResponse({ state: result.state, updatedAt: result.updatedAt });
  });

  addRoute(routes, "PATCH", "/workspace/:id/session-groups/assignments/:sessionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) throw new ApiError(400, "invalid_payload", "sessionId is required");
    const body = await readJsonBody(ctx.request);
    const groupId = typeof body.groupId === "string" && body.groupId.trim() ? body.groupId.trim() : null;
    const result = await updateWorkspaceSessionGroups(workspace.id, (current) => {
      const assignments = { ...current.assignments };
      if (groupId && current.groups.some((group) => group.id === groupId)) {
        assignments[sessionId] = groupId;
      } else {
        delete assignments[sessionId];
      }
      return { ...current, assignments };
    });
    sessionGroupEvents.record(workspace.id, "assigned", { sessionId, ...(groupId ? { groupId } : {}) });
    return jsonResponse({ state: result.state, updatedAt: result.updatedAt });
  });

  addRoute(routes, "PATCH", "/workspace/:id/session-groups/:groupId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const groupId = (ctx.params.groupId ?? "").trim();
    if (!groupId) throw new ApiError(400, "invalid_payload", "groupId is required");
    const body = await readJsonBody(ctx.request);
    const label = requireStringField(body, "label").slice(0, 120);
    const result = await updateWorkspaceSessionGroups(workspace.id, (current) => ({
      ...current,
      groups: current.groups.map((group) => group.id === groupId ? { ...group, label } : group),
    }));
    sessionGroupEvents.record(workspace.id, "updated", { groupId });
    return jsonResponse({ state: result.state, updatedAt: result.updatedAt });
  });

  addRoute(routes, "DELETE", "/workspace/:id/session-groups/:groupId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const groupId = (ctx.params.groupId ?? "").trim();
    if (!groupId) throw new ApiError(400, "invalid_payload", "groupId is required");
    const requestedDestinationGroupId = ctx.url.searchParams.get("destinationGroupId")?.trim() || null;
    const result = await updateWorkspaceSessionGroups(workspace.id, (current) => {
      const destinationGroupId = requestedDestinationGroupId && current.groups.some(
        (group) => group.id === requestedDestinationGroupId && group.id !== groupId,
      ) ? requestedDestinationGroupId : null;
      const assignments: Record<string, string> = {};
      for (const [sessionId, assignedGroupId] of Object.entries(current.assignments)) {
        if (assignedGroupId !== groupId) {
          assignments[sessionId] = assignedGroupId;
        } else if (destinationGroupId) {
          assignments[sessionId] = destinationGroupId;
        }
      }
      return {
        groups: current.groups.filter((group) => group.id !== groupId),
        assignments,
      };
    });
    sessionGroupEvents.record(workspace.id, "deleted", { groupId });
    return jsonResponse({ state: result.state, updatedAt: result.updatedAt });
  });

  addRoute(routes, "GET", "/workspace/:id/session-groups/events", "client", async (ctx) => {
    const workspace = await resolveWorkspaceWithoutBootstrap(config, ctx.params.id);
    const sinceRaw = ctx.url.searchParams.get("since");
    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const items = sessionGroupEvents.list(workspace.id, since);
    return jsonResponse({ items, cursor: sessionGroupEvents.cursor(workspace.id), workspaceId: workspace.id });
  });

  addRoute(routes, "GET", "/workspace/:id/sessions/:sessionId", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const item = await readWorkspaceSession(workspace, sessionId);
    return jsonResponse({ item });
  });

  addRoute(routes, "GET", "/workspace/:id/sessions/:sessionId/messages", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const items = await readWorkspaceSessionMessages(workspace, sessionId, {
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    });
    return jsonResponse({ items });
  });

  addRoute(routes, "GET", "/workspace/:id/sessions/:sessionId/snapshot", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }
    const item = await readWorkspaceSessionSnapshot(workspace, sessionId, {
      limit: parseOptionalPositiveInteger(ctx.url.searchParams.get("limit"), "limit"),
    });
    return jsonResponse({ item });
  });

  addRoute(routes, "DELETE", "/workspace/:id/sessions/:sessionId", "client", async (ctx) => {
    ensureWritable(config);
    requireClientScope(ctx, "collaborator");

    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sessionId = (ctx.params.sessionId ?? "").trim();
    if (!sessionId) {
      throw new ApiError(400, "invalid_payload", "sessionId is required");
    }

    const opencode = createWorkspaceOpencodeClient(config, workspace);
    unwrapOpencodeResult(
      await opencode.session.delete({ sessionID: sessionId }),
      `/session/${encodeURIComponent(sessionId)}`,
    );

    return jsonResponse({ ok: true });
  });
}
