import { addRoute, type Route } from "./registry.js";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}

/**
 * Strip transport-level fields that aren't useful to debug and wrap
 * the result in a markdown code block so it renders nicely in chat.
 */
function debugContent(body: Record<string, unknown>): string {
  const { stream: _, ...rest } = body;
  const payload = JSON.stringify({ debug: rest }, null, 2);
  return "```json\n" + payload + "\n```";
}

function debugChatCompletion(body: Record<string, unknown>): unknown {
  const content = debugContent(body);
  return {
    id: "debug-0",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: (body.model as string) ?? "echo",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function debugStreamChunks(body: Record<string, unknown>): ReadableStream<Uint8Array> {
  const content = debugContent(body);
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      // Role announcement chunk
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
          id: "debug-0",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "echo",
        })}\n\n`,
      ));

      // Full content in one delta chunk
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
          id: "debug-0",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: body.model ?? "echo",
        })}\n\n`,
      ));

      // Final usage chunk
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          id: "debug-0",
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

export function registerDebugRoutes(routes: Route[]): void {
  addRoute(routes, "POST", "/api/debug/v1/chat/completions", "none", async (ctx) => {
    let body: Record<string, unknown>;
    try {
      body = await ctx.request.json() as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: { message: "Invalid JSON", type: "invalid_request_error" } });
    }

    if (body.stream === true) {
      return new Response(debugStreamChunks(body), {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    return jsonResponse(debugChatCompletion(body));
  });
}
