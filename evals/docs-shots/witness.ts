import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export const WITNESS_PROVIDER_ID = "docs-shots-provider";
export const WITNESS_MODEL_ID = "docs-shots-model";

export const CHAT_PLUGIN_NAME = "Call Prep";
export const CHAT_SKILL_NAME = "call-prep";
export const CHAT_SKILL_DESCRIPTION = "Prepare a call brief whenever you ask to prep a call.";
export const CHAT_CLOSING_REPLY = "The call-prep skill is saved to your Library and ready to use.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function streamChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: "chatcmpl-docs-shots",
    object: "chat.completion.chunk",
    created: 1,
    model: WITNESS_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function sendStream(response: ServerResponse, chunks: Record<string, unknown>[]): void {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  let delayMs = 250;
  for (const chunk of chunks) {
    setTimeout(() => response.write(`data: ${JSON.stringify(chunk)}\n\n`), delayMs);
    delayMs += 250;
  }
  setTimeout(() => response.end("data: [DONE]\n\n"), delayMs);
}

function projectedCreateSkillTool(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.tools)) return null;
  for (const tool of payload.tools) {
    if (!isRecord(tool) || !isRecord(tool.function)) continue;
    const name = tool.function.name;
    if (typeof name === "string" && name.endsWith("_create_skill")) return name;
  }
  return null;
}

function completedToolCount(payload: Record<string, unknown>): number {
  return Array.isArray(payload.messages)
    ? payload.messages.filter((message) => isRecord(message) && message.role === "tool").length
    : 0;
}

export interface ModelWitness {
  url: string;
  close: () => Promise<void>;
}

/**
 * Deterministic OpenAI-compatible provider: when the create_skill tool is
 * projected it calls it once (creating the Call Prep skill), then closes with
 * a fixed reply. Any other conversation gets the closing reply directly.
 */
export async function startModelWitness(): Promise<ModelWitness> {
  const fixture = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/v1/models") {
        sendJson(response, 200, { object: "list", data: [{ id: WITNESS_MODEL_ID, object: "model" }] });
        return;
      }
      if (request.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
        const parsed: unknown = JSON.parse(await readBody(request));
        if (!isRecord(parsed)) throw new Error("The model witness received a non-object request.");
        const toolName = completedToolCount(parsed) === 0 ? projectedCreateSkillTool(parsed) : null;
        if (!toolName) {
          sendStream(response, [
            streamChunk({ role: "assistant" }),
            streamChunk({ content: CHAT_CLOSING_REPLY }),
            streamChunk({}, "stop"),
          ]);
          return;
        }
        sendStream(response, [
          streamChunk({ role: "assistant" }),
          streamChunk({
            tool_calls: [{
              index: 0,
              id: "call_create_call_prep",
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify({
                  pluginName: CHAT_PLUGIN_NAME,
                  skillMarkdown: [
                    "---",
                    `name: ${CHAT_SKILL_NAME}`,
                    `description: ${CHAT_SKILL_DESCRIPTION}`,
                    "---",
                    "",
                    "Whenever the user asks to prep a call, build a one-page brief with goals, context, and questions.",
                  ].join("\n"),
                }),
              },
            }],
          }),
          streamChunk({}, "tool_calls"),
        ]);
        return;
      }
      sendJson(response, 404, { error: { message: "not found" } });
    })().catch((error: unknown) => {
      if (!response.headersSent) sendJson(response, 500, { error: String(error) });
      else response.destroy(error instanceof Error ? error : undefined);
    });
  });
  await new Promise<void>((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", resolve);
  });
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("The model witness did not bind a port.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => fixture.close((error) => (error ? reject(error) : resolve()))),
  };
}
