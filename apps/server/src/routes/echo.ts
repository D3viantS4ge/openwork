import { addRoute, type Route } from "./registry.js";

/**
 * OpenAI Chat Completions request body (subset relevant to echo).
 */
interface EchoChatRequest {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
}

function lastMessageContent(body: EchoChatRequest): string {
  if (!body.messages || body.messages.length === 0) return "";
  const last = body.messages[body.messages.length - 1];
  return last?.content ?? "";
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}

function echoChatCompletion(body: EchoChatRequest): unknown {
  const content = lastMessageContent(body);
  return {
    id: "echo-0",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "echo",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function echoStreamChunks(body: EchoChatRequest): ReadableStream<Uint8Array> {
  const content = lastMessageContent(body);
  const encoder = new TextEncoder();
  let sentContent = false;

  return new ReadableStream({
    start(controller) {
      // Role announcement chunk
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
          id: "echo-0",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "echo",
        })}\n\n`,
      ));

      // Content delta chunk
      if (content) {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({
            choices: [{ index: 0, delta: { content }, finish_reason: null }],
            id: "echo-0",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: body.model ?? "echo",
          })}\n\n`,
        ));
      }

      // Final usage chunk
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          id: "echo-0",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "echo",
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        })}\n\n`,
      ));

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export function registerEchoRoutes(routes: Route[]): void {
  addRoute(routes, "POST", "/api/echo/v1/chat/completions", "none", async (ctx) => {
    let body: EchoChatRequest;
    try {
      body = await ctx.request.json() as EchoChatRequest;
    } catch {
      return jsonResponse({ error: { message: "Invalid JSON", type: "invalid_request_error" } });
    }

    if (body.stream) {
      return new Response(echoStreamChunks(body), {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    return jsonResponse(echoChatCompletion(body));
  });
}
