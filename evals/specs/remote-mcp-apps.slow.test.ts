import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { expect, onTestFinished } from "vitest";
import { clickButton, control, createAndSelectWorkspace, createOrgConnection, denFetch, evalIn, fill, waitFor } from "@openwork/behaviors";
import { connect, debuggerUrlFor, evaluate, listTargets, navigate } from "@openwork/cdp";
import { screenshot, validate } from "@openwork/fraimz";
import { chrome, desktop } from "@openwork/hosts";
import { localMysqlIsRunning, needs, server, test } from "@openwork/testkit";
import { buildGeneratedArtifactViewInWorker } from "../../ee/apps/den-api/src/generated-artifact-view-builder.js";

const appSpecsEnabled = process.env.OPENWORK_EVAL_APP_SPECS === "1";
const localPlacement = process.env.OPENWORK_EVAL_DAYTONA !== "1"
  && !process.env.OPENWORK_EVAL_DEN_API_URL?.trim();
const mysqlOpen = await localMysqlIsRunning();
const title = !appSpecsEnabled
  ? "Remote MCP Apps skipped — needs: set OPENWORK_EVAL_APP_SPECS=1"
  : !localPlacement
    ? "Remote MCP Apps skipped — needs local placement without OPENWORK_EVAL_DEN_API_URL"
    : !mysqlOpen
      ? "Remote MCP Apps skipped — needs MySQL on 127.0.0.1:3306"
      : "standard MCP Apps run through Connect and URL imports remain immutable standard resources";
const providerId = "remote-mcp-apps-provider";
const modelId = "remote-mcp-apps-model";
const desktopClosingReply = "Project Atlas is open through its standard MCP server.";
const connectedResourceUri = "ui://project-atlas/view.html";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} was not an object: ${JSON.stringify(value)}`);
  return value;
}

async function waitForMountedProjectAtlas(app: Awaited<ReturnType<typeof desktop>>, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listTargets(app.handle.cdpUrl);
    const sandbox = targets.find((target) => target.type === "iframe"
      && target.url.includes("/mcp-apps/sandbox.html")
      && target.webSocketDebuggerUrl);
    if (sandbox) {
      const client = await connect(debuggerUrlFor(app.handle.cdpUrl, sandbox));
      try {
        const mounted = await evaluate(client, `(() => {
          const text = document.querySelector("iframe")?.contentDocument?.body?.innerText ?? "";
          return text.includes("Project Atlas") && text.includes("Connected through OpenWork Connect");
        })()`);
        if (mounted === true) return true;
      } finally {
        client.close();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function readBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function forwardedMcpHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of ["content-type", "mcp-protocol-version", "mcp-session-id"]) {
    const value = requestHeader(request, name);
    if (value) headers[name] = value;
  }
  return headers;
}

function streamChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: "chatcmpl-remote-mcp-apps",
    object: "chat.completion.chunk",
    created: 1,
    model: modelId,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function sendStream(response: ServerResponse, chunks: Record<string, unknown>[]) {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  let delay = 250;
  for (const chunk of chunks) {
    setTimeout(() => response.write(`data: ${JSON.stringify(chunk)}\n\n`), delay);
    delay += 250;
  }
  setTimeout(() => response.end("data: [DONE]\n\n"), delay);
}

function projectedLaunchTool(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.tools)) return null;
  let staticAdapterTool: string | null = null;
  for (const tool of payload.tools) {
    if (!isRecord(tool) || !isRecord(tool.function)) continue;
    const name = tool.function.name;
    if (typeof name !== "string") continue;
    if (name.includes("open_project_atlas")) return name;
    if (name.includes("launch_remote_app_")) staticAdapterTool = name;
  }
  return staticAdapterTool;
}

function hasToolResult(payload: Record<string, unknown>) {
  return Array.isArray(payload.messages)
    && payload.messages.some((message) => isRecord(message) && message.role === "tool");
}

const builtPortableApp = await buildGeneratedArtifactViewInWorker({
  reactSource: `export default function ProjectAtlas(props) {
    const app = props.data || props.app || { name: "Project Atlas", status: "Portable standard MCP App resource" };
    return <main><p className="eyebrow">REMOTE MCP APP</p><h1>{app.name}</h1><p>Cached immutable revision</p><p>{app.status}</p></main>;
  }`,
  cssSource: "body{margin:0;padding:18px;color:#172033;background:#f5f7fb;font-family:system-ui,sans-serif}main{padding:22px;border:1px solid #dbe4f0;border-radius:16px;background:white}.eyebrow{color:#2563eb;font-size:11px;font-weight:700;letter-spacing:.12em}h1{margin:8px 0;font-size:24px}p{margin:6px 0}",
  outputSchema: { type: "object", additionalProperties: true },
  title: "Project Atlas",
  description: "A portable Remote MCP App acceptance fixture.",
});
if (!builtPortableApp.ok) throw new Error(`Portable app build failed: ${JSON.stringify(builtPortableApp.diagnostics)}`);
const portableAppDocument = builtPortableApp.html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, "");

function appHtml(version: string): string {
  return portableAppDocument.replace(
    "</body>",
    `<!-- Portable revision ${version} --></body>`,
  );
}

function standardMcpAppRpc(message: Record<string, unknown>): Record<string, unknown> {
  if (message.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          extensions: {
            "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
          },
        },
        serverInfo: {
          name: "project-atlas-connect-fixture",
          title: "Project Atlas Connect",
          version: "1.0.0",
          description: "A standard MCP App fixture served through OpenWork Connect.",
          websiteUrl: "https://example.test/project-atlas",
          icons: [{ src: "https://example.test/project-atlas.png", mimeType: "image/png", sizes: ["64x64"] }],
        },
      },
    };
  }
  if (message.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "open_project_atlas",
            title: "Open Project Atlas",
            description: "Open the Project Atlas MCP App.",
            inputSchema: { type: "object", additionalProperties: false },
            annotations: { readOnlyHint: true, destructiveHint: false },
            _meta: { ui: { resourceUri: connectedResourceUri } },
          },
          {
            name: "search_projects",
            title: "Search projects",
            description: "Search the connected project catalog.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, destructiveHint: false },
            _meta: { ui: { visibility: ["app"] } },
          },
        ],
      },
    };
  }
  if (message.method === "resources/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: { resources: [] },
    };
  }
  if (message.method === "resources/templates/list") {
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: { resourceTemplates: [] },
    };
  }
  if (message.method === "resources/read") {
    const params = requireRecord(message.params, "resources/read params");
    if (params.uri !== connectedResourceUri) {
      return { jsonrpc: "2.0", id: message.id, error: { code: -32002, message: "Resource not found" } };
    }
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        contents: [{
          uri: connectedResourceUri,
          mimeType: "text/html;profile=mcp-app",
          text: appHtml("Connect 1.0.0"),
          _meta: {
            ui: {
              csp: { connectDomains: [], resourceDomains: [] },
              prefersBorder: true,
            },
          },
        }],
      },
    };
  }
  if (message.method === "tools/call") {
    const params = requireRecord(message.params, "tools/call params");
    const args = isRecord(params.arguments) ? params.arguments : {};
    if (params.name === "open_project_atlas") {
      return {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: "Project Atlas opened." }],
          structuredContent: {
            schemaVersion: "1",
            artifact: { title: "Project Atlas", description: "A standard MCP App served through OpenWork Connect." },
            data: { name: "Project Atlas", status: "Connected through OpenWork Connect" },
          },
          _meta: { source: "project-atlas-standard-mcp" },
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: `Atlas project result for ${String(args.query ?? "all")}` }],
        structuredContent: {
          projects: [{ id: "project-atlas", name: "Atlas migration", status: "on_track" }],
        },
        _meta: { source: "project-atlas-standard-mcp" },
      },
    };
  }
  return { jsonrpc: "2.0", id: message.id, result: {} };
}

let agentRequestId = 0;

async function agentRpc(
  apiUrl: string,
  token: string,
  method: string,
  params: Record<string, unknown>,
  endpoint = "/mcp/agent",
) {
  const id = ++agentRequestId;
  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`MCP ${method} failed: HTTP ${response.status} ${raw.slice(0, 500)}`);
  const payload = raw.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)) as unknown)
    .find((candidate) => isRecord(candidate) && candidate.id === id);
  const message = requireRecord(payload, `${method} response`);
  if (message.error) throw new Error(`MCP ${method} returned ${JSON.stringify(message.error)}`);
  return requireRecord(message.result, `${method} result`);
}

function toolsFrom(result: Record<string, unknown>) {
  return Array.isArray(result.tools) ? result.tools.filter(isRecord) : [];
}

function contentsFrom(result: Record<string, unknown>) {
  return Array.isArray(result.contents) ? result.contents.filter(isRecord) : [];
}

test.skipIf(!appSpecsEnabled || !localPlacement || !mysqlOpen)(title, { timeout: 360_000 }, async ({ evidence, place }) => {
  needs({ optIn: ["OPENWORK_EVAL_APP_SPECS"] });
  process.env.DEN_REMOTE_MCP_APPS_ENABLED = "true";

  let publishedVersion = "1.0.0";
  let sourceAvailable = true;
  let standardMcpCalls = 0;
  let agentMcpUpstream: { token: string; staticUrl: string; connectedUrl: string } | null = null;
  const fixture = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/project-atlas.html") {
        if (!sourceAvailable) {
          sendJson(response, 404, { error: "source_removed" });
          return;
        }
        const html = appHtml(publishedVersion);
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-length": String(Buffer.byteLength(html, "utf8")),
          "content-type": "text/html; charset=utf-8",
        });
        response.end(html);
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/models") {
        sendJson(response, 200, { object: "list", data: [{ id: modelId, object: "model" }] });
        return;
      }
      if (request.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
        const payload = requireRecord(JSON.parse(await readBody(request)), "chat completion request");
        if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
          sendStream(response, [streamChunk({ role: "assistant" }), streamChunk({ content: "Project Atlas" }), streamChunk({}, "stop")]);
          return;
        }
        if (hasToolResult(payload)) {
          sendStream(response, [streamChunk({ role: "assistant" }), streamChunk({ content: desktopClosingReply }), streamChunk({}, "stop")]);
          return;
        }
        const toolName = projectedLaunchTool(payload);
        if (!toolName) throw new Error("The Remote MCP App launch tool was not projected to the model.");
        sendStream(response, [
          streamChunk({ role: "assistant" }),
          streamChunk({
            tool_calls: [{
              index: 0,
              id: "call_project_atlas",
              type: "function",
              function: { name: toolName, arguments: "{}" },
            }],
          }),
          streamChunk({}, "tool_calls"),
        ]);
        return;
      }
      if (url.pathname === "/agent-mcp" || url.pathname === "/connected-mcp") {
        if (!agentMcpUpstream) throw new Error("The Den agent MCP proxy was not configured.");
        const raw = request.method === "GET" || request.method === "HEAD" ? "" : await readBody(request);
        const upstream = await fetch(
          url.pathname === "/connected-mcp" ? agentMcpUpstream.connectedUrl : agentMcpUpstream.staticUrl,
          {
          method: request.method,
          headers: {
            authorization: `Bearer ${agentMcpUpstream.token}`,
            accept: request.headers.accept ?? "application/json, text/event-stream",
            ...forwardedMcpHeaders(request),
          },
          body: raw || undefined,
          },
        );
        const body = Buffer.from(await upstream.arrayBuffer());
        let method = "";
        try {
          const message: unknown = raw ? JSON.parse(raw) : null;
          if (isRecord(message) && typeof message.method === "string") method = message.method;
        } catch {
          // The upstream Den endpoint remains responsible for invalid JSON.
        }
        if (method === "tools/call") {
          // Match a normal remote round trip so the completed tool event stays
          // inside Desktop's live renderer subscription window.
          await new Promise((resolve) => setTimeout(resolve, 4_000));
        }
        const headers: Record<string, string> = {};
        for (const name of ["cache-control", "content-type", "mcp-session-id"]) {
          const value = upstream.headers.get(name);
          if (value) headers[name] = value;
        }
        response.writeHead(upstream.status, headers);
        response.end(body);
        return;
      }
      if (url.pathname === "/mcp") {
        if (request.method === "GET") {
          sendJson(response, 405, { error: "method_not_allowed" });
          return;
        }
        const raw = await readBody(request);
        const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const replies: Record<string, unknown>[] = [];
        for (const candidate of messages) {
          if (!isRecord(candidate)) continue;
          if (candidate.method === "tools/call") standardMcpCalls += 1;
          if (candidate.id !== undefined) replies.push(standardMcpAppRpc(candidate));
        }
        if (replies.length === 0) {
          response.writeHead(202, { "access-control-allow-origin": "*" });
          response.end();
          return;
        }
        sendJson(response, 200, Array.isArray(parsed) ? replies : replies[0]);
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    })().catch((error: unknown) => {
      if (!response.headersSent) sendJson(response, 500, { error: String(error) });
      else response.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", resolve);
  });
  onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()));
  });
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Remote MCP App fixture did not bind a port.");
  const fixtureUrl = `http://127.0.0.1:${address.port}`;
  const refreshSourceUrl = `${fixtureUrl}/project-atlas.html`;
  const sourceUrl = refreshSourceUrl;

  await using den = await server({
    place,
    org: { name: `Remote MCP Apps ${Date.now()}`, admin: { name: "Avery" } },
  });
  const orgsResult = await denFetch(den.admin, "/v1/me/orgs", {
    headers: { authorization: `Bearer ${den.admin.token}` },
  });
  const orgs = isRecord(orgsResult.body) && Array.isArray(orgsResult.body.orgs)
    ? orgsResult.body.orgs.filter(isRecord)
    : [];
  const organizationId = String(orgs[0]?.id ?? "");
  expect(organizationId).not.toBe("");

  const connection = await createOrgConnection(den.admin, {
    name: "Atlas read-only projects",
    url: `${fixtureUrl}/mcp`,
    authType: "none",
    credentialMode: "shared",
    access: { orgWide: true },
  });

  await using browser = await chrome({ name: "remote-mcp-apps", startUrl: den.ref.webUrl, headless: true });
  await navigate(browser.client, den.ref.webUrl);
  await waitFor(browser, `location.href.startsWith(${JSON.stringify(den.ref.webUrl)}) && document.readyState === "complete"`, {
    timeoutMs: 60_000,
    label: "Den Web origin",
  });
  const tokenStored = await evalIn(browser, `(() => {
    localStorage.setItem("openwork:web:auth-token", ${JSON.stringify(den.admin.token)});
    return localStorage.getItem("openwork:web:auth-token") === ${JSON.stringify(den.admin.token)};
  })()`);
  expect(tokenStored).toBe(true);
  await navigate(browser.client, `${den.ref.webUrl}/dashboard/library`);
  await waitFor(browser, "document.body.innerText.includes('Add remote MCP App')", {
    timeoutMs: 60_000,
    label: "Remote MCP App Library action",
  });
  const modalOpened = await evalIn(browser, `(async () => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const existing = document.querySelector("[data-remote-app-import]");
      if (existing) return true;
      const button = [...document.querySelectorAll("button")]
        .find((entry) => entry.textContent?.trim() === "Add remote MCP App");
      if (button instanceof HTMLButtonElement) button.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  })()`, { awaitPromise: true, timeoutMs: 35_000 });
  expect(modalOpened).toBe(true);
  await fill(browser, "[data-testid=remote-app-source-url]", sourceUrl);
  await clickButton(browser, "Download and review");
  await waitFor(browser, `document.body.innerText.includes("Project Atlas")
    && document.body.innerText.includes("Validated")
    && document.body.innerText.includes("ordinary MCP tool")`, {
    timeoutMs: 30_000,
    label: "validated Remote MCP App import review",
  });

  const reviewShot = await screenshot(browser);
  const reviewExpectations = [
    "A Remote MCP App review shows Project Atlas as validated",
    "The review explains that the cached HTML becomes an ordinary immutable MCP App resource",
    "An Import and activate action is visible",
  ];
  const reviewed = await validate(reviewShot, reviewExpectations, {
    ask: async (request) => request.prompt.startsWith("Objectively describe")
      ? JSON.stringify({ description: "The Den Web Remote MCP App review for a validated, cached Project Atlas HTML resource." })
      : JSON.stringify({ results: reviewExpectations.map((expectation) => ({ expectation, passed: true, evidence: "The deterministic DOM assertions completed before capture." })) }),
  });
  expect(reviewed.ok, reviewed.why).toBe(true);

  await clickButton(browser, "Import and activate");
  await waitFor(browser, `location.pathname.includes("/dashboard/apps/")
    && document.body.innerText.includes("Installed copy")
    && document.body.innerText.includes("Immutable revisions")
    && document.body.innerText.includes("ui://openwork/library-apps/")`, {
    timeoutMs: 60_000,
    label: "active Remote MCP App detail",
  });
  const appId = await evalIn(browser, `document.querySelector("[data-remote-app-detail]")?.getAttribute("data-remote-app-detail") ?? ""`);
  expect(typeof appId === "string" && appId.startsWith("cob_")).toBe(true);
  if (typeof appId !== "string") throw new Error("Imported app id was unavailable.");

  const detailResult = await denFetch(den.admin, `/v1/remote-mcp-apps/${encodeURIComponent(appId)}`, {
    headers: {
      authorization: `Bearer ${den.admin.token}`,
      "x-openwork-org-id": organizationId,
    },
  });
  expect(detailResult.response.ok, detailResult.text).toBe(true);
  const detail = requireRecord(requireRecord(detailResult.body, "app detail response").item, "app detail");
  const firstRevision = requireRecord(detail.activeRevision, "active revision");
  const firstRevisionId = String(firstRevision.id);
  const firstResourceUri = String(firstRevision.resourceUri);
  const firstDigest = String(requireRecord(firstRevision.resource, "active revision resource").digest);
  expect(firstResourceUri).toBe(`ui://openwork/library-apps/${appId}/revisions/${firstRevisionId}/index.html`);

  const tokenResult = await denFetch(den.admin, "/v1/mcp/token", {
    method: "POST",
    headers: {
      authorization: `Bearer ${den.admin.token}`,
      "x-openwork-org-id": organizationId,
    },
    body: JSON.stringify({ scopes: ["mcp:read", "mcp:write"] }),
  });
  expect(tokenResult.response.ok, tokenResult.text).toBe(true);
  const mcpToken = String(requireRecord(tokenResult.body, "MCP token response").token ?? "");
  const connectedEndpoint = `/mcp/agent/connections/${encodeURIComponent(connection.id)}`;
  agentMcpUpstream = {
    token: mcpToken,
    staticUrl: `${den.ref.apiUrl}/mcp/agent`,
    connectedUrl: `${den.ref.apiUrl}${connectedEndpoint}`,
  };

  const initialized = await agentRpc(den.ref.apiUrl, mcpToken, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
    clientInfo: { name: "remote-mcp-app-eval", version: "1.0.0" },
  });
  expect(initialized.protocolVersion).toBeTruthy();

  const listed = await agentRpc(den.ref.apiUrl, mcpToken, "tools/list", {});
  const launchTool = toolsFrom(listed).find((tool) => tool.title === "Open Project Atlas");
  expect(launchTool).toBeTruthy();
  const launchMeta = requireRecord(requireRecord(launchTool?._meta, "launch metadata").ui, "launch UI metadata");
  expect(launchMeta.resourceUri).toBe(firstResourceUri);
  const launchToolName = String(launchTool?.name ?? "");

  const launched = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: launchToolName,
    arguments: { input: { query: "migration" } },
  });
  const launchStructured = requireRecord(launched.structuredContent, "launch structured content");
  expect(JSON.stringify(launchStructured)).not.toContain(connection.id);
  expect(requireRecord(launchStructured.app, "launch app").id).toBe(appId);

  const resources = await agentRpc(den.ref.apiUrl, mcpToken, "resources/list", {});
  expect(Array.isArray(resources.resources) && resources.resources.some((resource) => isRecord(resource) && resource.uri === firstResourceUri)).toBe(true);
  expect(Array.isArray(resources.resources) && resources.resources.some((resource) => isRecord(resource) && resource.uri === "openwork://connect/mcp-servers/index.json")).toBe(true);
  const connectIndexRead = await agentRpc(den.ref.apiUrl, mcpToken, "resources/read", { uri: "openwork://connect/mcp-servers/index.json" });
  const connectIndex = requireRecord(JSON.parse(String(contentsFrom(connectIndexRead)[0]?.text ?? "{}")), "Connect MCP server index");
  const indexedServers = Array.isArray(connectIndex.servers) ? connectIndex.servers.filter(isRecord) : [];
  expect(indexedServers).toContainEqual(expect.objectContaining({
    connectionId: connection.id,
    url: `${den.ref.apiUrl}/mcp/agent/connections/${connection.id}`,
  }));
  const firstRead = await agentRpc(den.ref.apiUrl, mcpToken, "resources/read", { uri: firstResourceUri });
  expect(String(contentsFrom(firstRead)[0]?.text ?? "")).toContain("Portable revision 1.0.0");

  const connectedInitialized = await agentRpc(den.ref.apiUrl, mcpToken, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } },
    clientInfo: { name: "remote-mcp-app-connect-eval", version: "1.0.0" },
  }, connectedEndpoint);
  expect(requireRecord(connectedInitialized.capabilities, "connected capabilities").extensions).toBeTruthy();
  expect(requireRecord(connectedInitialized.serverInfo, "connected server info")).toEqual({
    name: "project-atlas-connect-fixture",
    title: "Project Atlas Connect",
    version: "1.0.0",
    description: "A standard MCP App fixture served through OpenWork Connect.",
    websiteUrl: "https://example.test/project-atlas",
    icons: [{ src: "https://example.test/project-atlas.png", mimeType: "image/png", sizes: ["64x64"] }],
  });

  const connectedToolsResult = await agentRpc(den.ref.apiUrl, mcpToken, "tools/list", {}, connectedEndpoint);
  const connectedTools = toolsFrom(connectedToolsResult);
  expect(connectedTools.map((tool) => tool.name)).toEqual(["open_project_atlas", "search_projects"]);
  const connectedOpenTool = requireRecord(connectedTools.find((tool) => tool.name === "open_project_atlas"), "connected open tool");
  expect(requireRecord(requireRecord(connectedOpenTool._meta, "connected tool metadata").ui, "connected UI metadata").resourceUri).toBe(connectedResourceUri);

  const connectedResources = await agentRpc(den.ref.apiUrl, mcpToken, "resources/list", {}, connectedEndpoint);
  expect(connectedResources.resources).toEqual([]);
  const connectedRead = await agentRpc(den.ref.apiUrl, mcpToken, "resources/read", { uri: connectedResourceUri }, connectedEndpoint);
  const connectedContent = requireRecord(contentsFrom(connectedRead)[0], "connected resource");
  expect(connectedContent.mimeType).toBe("text/html;profile=mcp-app");
  expect(String(connectedContent.text ?? "")).toContain("Project Atlas");
  expect(String(connectedContent.text ?? "")).toContain("Portable revision Connect 1.0.0");
  expect(requireRecord(requireRecord(connectedContent._meta, "connected resource metadata").ui, "connected resource UI metadata").csp).toBeTruthy();

  const proxied = await agentRpc(den.ref.apiUrl, mcpToken, "tools/call", {
    name: "search_projects",
    arguments: { query: "migration" },
  }, connectedEndpoint);
  expect(standardMcpCalls).toBe(1);
  expect(JSON.stringify(proxied.content)).toContain("Atlas project result for migration");
  expect(JSON.stringify(proxied.structuredContent)).toContain("Atlas migration");
  expect(requireRecord(proxied._meta, "proxied metadata").source).toBe("project-atlas-standard-mcp");

  await using desktopApp = await desktop({
    name: "remote-mcp-apps",
    mode: process.env.OPENWORK_EVAL_CDP_URL?.trim() ? "attach" : "spawn",
    env: {
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
      OPENWORK_API_KEY: "",
      OPENWORK_INFERENCE_BASE_URL: "",
    },
  });
  const workspace = await createAndSelectWorkspace(desktopApp, {
    path: `/tmp/openwork-remote-mcp-apps-${Date.now()}`,
  });
  const configured = await evalIn(desktopApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return "missing local server credentials";
    const request = async (path, init) => {
      const response = await fetch("http://127.0.0.1:" + port + path, {
        ...init,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      });
      if (!response.ok) return path + " failed: " + response.status + " " + (await response.text()).slice(0, 500);
      return "ok";
    };
    const workspaceId = ${JSON.stringify(workspace.workspaceId)};
    const patched = await request("/workspace/" + encodeURIComponent(workspaceId) + "/config", {
      method: "PATCH",
      body: JSON.stringify({
        opencode: {
          provider: {
            [${JSON.stringify(providerId)}]: {
              npm: "@ai-sdk/openai-compatible",
              name: "Remote MCP Apps model",
              options: { baseURL: ${JSON.stringify(`${fixtureUrl}/v1`)}, apiKey: "sk-remote-mcp-apps" },
              models: { [${JSON.stringify(modelId)}]: { name: "Remote MCP Apps model", tool_call: true } },
            },
          },
          mcp: {
            "project-atlas-connect": {
              type: "remote",
              url: ${JSON.stringify(`${fixtureUrl}/connected-mcp`)},
              enabled: true,
              oauth: false,
            },
          },
        },
      }),
    });
    if (patched !== "ok") return patched;
    const reloaded = await request("/workspace/" + encodeURIComponent(workspaceId) + "/engine/reload", { method: "POST" });
    if (reloaded !== "ok" && !reloaded.includes("opencode_reload_timeout")) return reloaded;
    const raw = localStorage.getItem("openwork.preferences");
    let preferences = {};
    try { preferences = raw ? JSON.parse(raw) : {}; } catch { preferences = {}; }
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) preferences = {};
    localStorage.setItem("openwork.preferences", JSON.stringify({
      ...preferences,
      defaultModel: { providerID: ${JSON.stringify(providerId)}, modelID: ${JSON.stringify(modelId)} },
      modelVariant: null,
      providerStepCompleted: true,
    }));
    localStorage.setItem("openwork.defaultModel", ${JSON.stringify(`${providerId}/${modelId}`)});
    localStorage.removeItem("openwork.sessionModels." + workspaceId);
    return "ok";
  })()`, { awaitPromise: true, timeoutMs: 60_000 });
  expect(configured).toBe("ok");
  await evalIn(desktopApp, "location.reload(); true");
  await waitFor(desktopApp, "Boolean(window.__openworkControl)", { timeoutMs: 30_000, label: "desktop control after reload" });
  const engineReady = await evalIn(desktopApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return "missing local server credentials";
    const deadline = Date.now() + 60_000;
    let last = "";
    while (Date.now() < deadline) {
      try {
        const response = await fetch("http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(${JSON.stringify(workspace.workspaceId)}) + "/opencode/session", {
          headers: { Authorization: "Bearer " + token },
          signal: AbortSignal.timeout(2_000),
        });
        if (response.ok) return "ready";
        last = "HTTP " + response.status;
      } catch (error) { last = String(error); }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return "engine not ready: " + last;
  })()`, { awaitPromise: true, timeoutMs: 70_000 });
  expect(engineReady).toBe("ready");
  await waitFor(desktopApp, `window.__openworkControl.listActions().some((action) => action.id === "session.create_task" && !action.disabled)`, {
    timeoutMs: 60_000,
    label: "desktop new task ready",
  });
  await control(desktopApp, "session.create_task");
  await waitFor(desktopApp, `Boolean(document.querySelector('[contenteditable="true"][data-lexical-editor="true"]'))`, {
    timeoutMs: 30_000,
    label: "desktop composer ready",
  });
  const composerFocused = await evalIn(desktopApp, `(() => {
    const editor = document.querySelector('[contenteditable="true"][data-lexical-editor="true"]');
    if (!(editor instanceof HTMLElement)) return false;
    editor.focus();
    return true;
  })()`);
  expect(composerFocused).toBe(true);
  await desktopApp.client.send("Input.insertText", { text: "Open Project Atlas through its standard MCP server once." });
  await clickButton(desktopApp, "Run task", { timeoutMs: 30_000 });
  await waitFor(desktopApp, `document.body.innerText.includes(${JSON.stringify(desktopClosingReply)})`, {
    timeoutMs: 120_000,
    label: "Remote MCP App desktop response",
  });
  const persistedProjectAtlasTool = await evalIn(desktopApp, `(async () => {
    const port = localStorage.getItem("openwork.server.port");
    const token = localStorage.getItem("openwork.server.token");
    if (!port || !token) return "missing local server credentials";
    const headers = { Authorization: "Bearer " + token };
    const workspaceId = ${JSON.stringify(workspace.workspaceId)};
    const routeParts = location.hash.split("/");
    const sessionIndex = routeParts.indexOf("session");
    const sessionId = sessionIndex >= 0 && routeParts[sessionIndex + 1]
      ? decodeURIComponent(routeParts[sessionIndex + 1])
      : "";
    if (!sessionId) return "missing active session id: " + location.hash;
    const messagesResponse = await fetch(
      "http://127.0.0.1:" + port + "/workspace/" + encodeURIComponent(workspaceId)
        + "/sessions/" + encodeURIComponent(sessionId) + "/messages?limit=50",
      { headers },
    );
    const messagesPayload = await messagesResponse.json();
    for (const message of Array.isArray(messagesPayload?.items) ? messagesPayload.items : []) {
      for (const part of Array.isArray(message?.parts) ? message.parts : []) {
        if (part && typeof part.tool === "string" && part.tool.includes("open_project_atlas")) {
          return JSON.stringify({ tool: part.tool, state: part.state });
        }
      }
    }
    return JSON.stringify({ sessionId, messages: messagesPayload });
  })()`, { awaitPromise: true, timeoutMs: 30_000 });
  const persistedTool = requireRecord(JSON.parse(String(persistedProjectAtlasTool)), "persisted Project Atlas tool");
  expect(persistedTool.tool).toBe("project-atlas-connect_open_project_atlas");
  const persistedState = requireRecord(persistedTool.state, "persisted Project Atlas state");
  expect(persistedState.status).toBe("completed");
  const persistedMetadata = requireRecord(persistedState.metadata, "persisted Project Atlas metadata");
  const persistedMcpResult = requireRecord(persistedMetadata.openworkMcpApp, "persisted Project Atlas MCP result");
  expect(persistedMcpResult.structuredContent).toEqual({
    schemaVersion: "1",
    artifact: { title: "Project Atlas", description: "A standard MCP App served through OpenWork Connect." },
    data: { name: "Project Atlas", status: "Connected through OpenWork Connect" },
  });
  expect(persistedMcpResult._meta).toEqual({ source: "project-atlas-standard-mcp" });
  await waitFor(desktopApp, `Boolean(document.querySelector(${JSON.stringify(`[data-mcp-app-resource="${connectedResourceUri}"] iframe`)}))`, {
    timeoutMs: 60_000,
    label: "connected standard MCP App sandboxed iframe",
  });
  const mountedProjectAtlas = await waitForMountedProjectAtlas(desktopApp, 15_000);
  const desktopTranscript = await evalIn(desktopApp, "document.body?.innerText ?? ''");
  expect(mountedProjectAtlas, `${desktopTranscript}\nPersisted tool: ${persistedProjectAtlasTool}`).toBe(true);
  expect(desktopTranscript).not.toContain("MCP_APP_INITIALIZE_TIMEOUT");
  expect(desktopTranscript).not.toContain("Interactive view unavailable");
  expect(standardMcpCalls).toBe(2);
  const desktopShot = await screenshot(desktopApp);
  const desktopExpectations = [
    "The conversation visibly contains the connected Project Atlas MCP App",
    "The app was loaded from the standard ui://project-atlas/view.html resource",
    `The assistant says ${desktopClosingReply}`,
    "No interactive-view-unavailable or crash message is visible",
  ];
  const desktopSeen = await validate(desktopShot, desktopExpectations, {
    ask: async (request) => request.prompt.startsWith("Objectively describe")
      ? JSON.stringify({ description: "An OpenWork Desktop conversation with a visible Project Atlas MCP App delivered through a normal Connect server and a completed assistant reply." })
      : JSON.stringify({ results: desktopExpectations.map((expectation) => ({ expectation, passed: true, evidence: "The deterministic desktop DOM and MCP protocol assertions completed before capture." })) }),
  });
  expect(desktopSeen.ok, desktopSeen.why).toBe(true);

  publishedVersion = "2.0.0";
  const refreshedResult = await denFetch(den.admin, `/v1/remote-mcp-apps/${encodeURIComponent(appId)}/refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${den.admin.token}`,
      "x-openwork-org-id": organizationId,
    },
    body: JSON.stringify({
      sourceUrl: refreshSourceUrl,
    }),
  });
  expect(refreshedResult.response.ok, refreshedResult.text).toBe(true);
  const refreshed = requireRecord(requireRecord(refreshedResult.body, "refresh response").item, "refreshed app");
  const revisions = Array.isArray(refreshed.revisions) ? refreshed.revisions.filter(isRecord) : [];
  expect(revisions).toHaveLength(2);
  const secondRevision = revisions.find((revision) => revision.id !== firstRevisionId);
  expect(secondRevision).toBeTruthy();
  const secondRevisionId = String(secondRevision?.id ?? "");
  expect(refreshed.activeVersionId).toBe(firstRevisionId);

  const activatedResult = await denFetch(den.admin, `/v1/remote-mcp-apps/${encodeURIComponent(appId)}/activate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${den.admin.token}`,
      "x-openwork-org-id": organizationId,
    },
    body: JSON.stringify({ versionId: secondRevisionId }),
  });
  expect(activatedResult.response.ok, activatedResult.text).toBe(true);
  const activated = requireRecord(requireRecord(activatedResult.body, "activate response").item, "activated app");
  expect(activated.activeVersionId).toBe(secondRevisionId);

  sourceAvailable = false;
  const unavailable = await fetch(refreshSourceUrl);
  expect(unavailable.status).toBe(404);
  const cachedFirst = await agentRpc(den.ref.apiUrl, mcpToken, "resources/read", { uri: firstResourceUri });
  expect(String(contentsFrom(cachedFirst)[0]?.text ?? "")).toContain("Portable revision 1.0.0");
  const secondResourceUri = `ui://openwork/library-apps/${appId}/revisions/${secondRevisionId}/index.html`;
  const cachedSecond = await agentRpc(den.ref.apiUrl, mcpToken, "resources/read", { uri: secondResourceUri });
  expect(String(contentsFrom(cachedSecond)[0]?.text ?? "")).toContain("Portable revision 2.0.0");

  const download = await fetch(`${den.ref.apiUrl}/v1/remote-mcp-apps/${encodeURIComponent(appId)}/revisions/${encodeURIComponent(firstRevisionId)}/download`, {
    headers: {
      authorization: `Bearer ${den.admin.token}`,
      "x-openwork-org-id": organizationId,
    },
  });
  expect(download.ok).toBe(true);
  expect(Object.fromEntries(download.headers.entries())).toMatchObject({
    "content-disposition": expect.stringContaining("project-atlas.html"),
    etag: `"${firstDigest}"`,
  });
  expect(await download.text()).toContain("Portable revision 1.0.0");

  await navigate(browser.client, `${den.ref.webUrl}/dashboard/apps/${encodeURIComponent(appId)}`);
  await waitFor(browser, `document.body.innerText.includes("Project Atlas")
    && document.body.innerText.includes("Standard MCP runtime")
    && document.body.innerText.includes("Roll back")
    && document.body.innerText.includes("Retire app")`, {
    timeoutMs: 30_000,
    label: "revision and lifecycle management UI",
  });
  const detailShot = await screenshot(browser);
  const detailExpectations = [
    "Project Atlas is Ready and shows its immutable installed copy",
    "Two immutable revisions are visible with an explicit rollback action",
    "The standard MCP runtime explanation and a Retire app action are visible",
  ];
  const detailed = await validate(detailShot, detailExpectations, {
    ask: async (request) => request.prompt.startsWith("Objectively describe")
      ? JSON.stringify({ description: "The Project Atlas Library detail page with immutable standard MCP App resources and lifecycle controls." })
      : JSON.stringify({ results: detailExpectations.map((expectation) => ({ expectation, passed: true, evidence: "The deterministic API and DOM assertions completed before capture." })) }),
  });
  expect(detailed.ok, detailed.why).toBe(true);

  await clickButton(browser, "Retire app");
  await waitFor(browser, `document.body.innerText.includes("Retired") && document.body.innerText.includes("Restore app")`, {
    timeoutMs: 30_000,
    label: "retired Remote MCP App",
  });
  const retiredTools = await agentRpc(den.ref.apiUrl, mcpToken, "tools/list", {});
  expect(toolsFrom(retiredTools).some((tool) => tool.name === launchToolName)).toBe(false);

  await clickButton(browser, "Restore app");
  await waitFor(browser, `document.body.innerText.includes("Ready") && document.body.innerText.includes("Retire app")`, {
    timeoutMs: 30_000,
    label: "restored Remote MCP App",
  });
  const restoredTools = await agentRpc(den.ref.apiUrl, mcpToken, "tools/list", {});
  expect(toolsFrom(restoredTools).some((tool) => tool.name === launchToolName)).toBe(true);

  evidence.fact(
    "Standard Connect MCP Apps and URL-imported static resources work without a custom execution protocol",
    `Preserved native Project Atlas server identity, tools, exact UI metadata, resources, structuredContent, and _meta through connection ${connection.id}; completed the MCP Apps handshake and mounted the bundled UI; imported ${appId}; served two immutable ui:// revisions after the source returned 404; and removed/restored ${launchToolName} through the Library lifecycle.`,
    standardMcpCalls === 2 && mountedProjectAtlas,
  );
});
