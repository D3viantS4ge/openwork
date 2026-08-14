import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { StreamableHTTPTransport } from "@hono/mcp"
import { normalizeDenTypeId } from "@openwork-ee/utils/typeid"
import type { Hono } from "hono"
import type { RequestIdVariables } from "hono/request-id"
import {
  getExternalMcpConnection,
  memberCanUseExternalMcpConnection,
} from "../capability-sources/external-mcp-connections.js"
import {
  callExternalMcpToolRaw,
  describeExternalMcpServer,
  listExternalMcpResources,
  listExternalMcpResourceTemplates,
  listExternalMcpTools,
  readExternalMcpResource,
} from "../capability-sources/external-mcp-client-runtime.js"
import { evaluateToolPolicy } from "../capability-sources/external-mcp-tool-policy.js"
import { env } from "../env.js"
import { tokenRoute } from "../middleware/index.js"
import { resolvePublicOrigin } from "../capability-sources/generic-oauth.js"
import { getMcpResourceContext, verifyMcpRequest } from "./auth.js"
import { resolveMcpMemberIdentity } from "./external-capabilities.js"
import { preflightMcpJsonRpcRequest } from "./json-rpc-preflight.js"

function toolArguments(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/**
 * Exposes one member-authorized Connect connection as one ordinary MCP
 * server. Names, schemas, resource URIs, UI metadata, results, and provider
 * errors stay on their native MCP protocol fields instead of being projected
 * through OpenWork-specific wrapper tools.
 *
 * Keeping a connection on its own endpoint also preserves the MCP Apps
 * same-server execution boundary and prevents collisions between two servers
 * that legitimately advertise the same tool name.
 */
export function registerExternalConnectionProxyRoutes<T extends { Variables: RequestIdVariables & Record<string, unknown> }>(app: Hono<T>) {
  app.all("/mcp/agent/connections/:connectionId", tokenRoute, async (c) => {
    const requestIdValue = c.get("requestId")
    const requestId = typeof requestIdValue === "string" ? requestIdValue : "unknown"
    const principal = await verifyMcpRequest(
      c.req.raw.headers,
      getMcpResourceContext(c.req.raw, "agent", requestId),
    )
    if (principal instanceof Response) return principal

    const preflightResponse = await preflightMcpJsonRpcRequest(c.req.raw, requestId)
    if (preflightResponse) return preflightResponse

    let connectionId
    try {
      connectionId = normalizeDenTypeId("externalMcpConnection", c.req.param("connectionId"))
    } catch {
      throw new McpError(ErrorCode.InvalidRequest, "The MCP connection id is invalid.")
    }
    const organizationId = normalizeDenTypeId("organization", principal.organizationId)
    const member = await resolveMcpMemberIdentity({
      userId: principal.userId,
      organizationId,
    })
    if (!member) throw new McpError(ErrorCode.InvalidRequest, "The MCP connection is not available.")

    const connection = await getExternalMcpConnection({ organizationId, connectionId })
    const allowed = connection && await memberCanUseExternalMcpConnection({
      connectionId,
      orgMembershipId: member.orgMembershipId,
      teamIds: member.teamIds,
    })
    if (!connection || !allowed) throw new McpError(ErrorCode.InvalidRequest, "The MCP connection is not available.")

    const redirectUriBase = resolvePublicOrigin(c.req.raw, env.apiPublicUrl)
    const redirectUri = `${redirectUriBase}/v1/mcp-connections/${encodeURIComponent(connection.id)}/connect/callback`
    const downstreamMember = { orgMembershipId: member.orgMembershipId }
    const operation = {
      connection,
      redirectUri,
      member: downstreamMember,
      diagnosticReferenceId: requestId,
    }
    const descriptor = await describeExternalMcpServer(operation)
    const downstreamUi = descriptor.capabilities.extensions?.[EXTENSION_ID]
    const server = new McpServer(descriptor.serverInfo ?? {
      name: connection.name,
      version: "1.0.0",
    }, {
      capabilities: {
        ...(descriptor.capabilities.tools ? { tools: { listChanged: false } } : {}),
        ...(descriptor.capabilities.resources ? { resources: { listChanged: false, subscribe: false } } : {}),
        ...(downstreamUi ? { extensions: { [EXTENSION_ID]: downstreamUi } } : {}),
      },
      instructions: descriptor.instructions
        ?? `This is the member-authorized OpenWork Connect proxy for ${connection.name}. Tool names and resources are provided by that MCP server.`,
    })

    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: (await listExternalMcpTools(connection, redirectUri, downstreamMember, requestId))
        .filter((tool) => !evaluateToolPolicy(connection.toolPolicy, tool.name).blocked),
    }))
    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const policy = evaluateToolPolicy(connection.toolPolicy, request.params.name)
      if (policy.blocked) throw new McpError(ErrorCode.InvalidRequest, `Tool ${request.params.name} is disabled by OpenWork Connect policy.`)
      return callExternalMcpToolRaw({
        ...operation,
        toolName: request.params.name,
        args: toolArguments(request.params.arguments),
      })
    })
    server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: await listExternalMcpResources(operation),
    }))
    server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
      resourceTemplates: await listExternalMcpResourceTemplates(operation),
    }))
    server.server.setRequestHandler(ReadResourceRequestSchema, async (request) => (
      readExternalMcpResource({ ...operation, uri: request.params.uri })
    ))

    const transport = new StreamableHTTPTransport()
    await server.connect(transport)
    const response = await transport.handleRequest(c)
    return response ?? new Response(null, { status: 204 })
  })
}

export const STANDARD_MCP_APP_EXTENSION = {
  extensionId: EXTENSION_ID,
  mimeType: RESOURCE_MIME_TYPE,
} as const
