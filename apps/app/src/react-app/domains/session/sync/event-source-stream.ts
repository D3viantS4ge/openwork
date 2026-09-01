/**
 * Adapts a native `EventSource` (Server-Sent Events) connection into an async
 * iterable of parsed JSON events.
 *
 * Firefox stalls a *second* concurrent streaming `fetch` to the same origin —
 * the request is initiated client-side but never reaches the server — which
 * breaks the SDK's fetch-based SSE client when two OpenWork tabs are open.
 * `EventSource` uses a separate connection path that is unaffected, so the
 * session sync subscribes through this adapter instead.
 *
 * The stream yields each `data:` payload parsed as JSON, honors the passed
 * `AbortSignal`, and relies on `EventSource`'s built-in reconnection for
 * transient network errors (the caller's watchdog still owns the teardown).
 */
export async function* eventSourceStream(
  url: string,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  if (signal.aborted) return;

  const source = new EventSource(url);
  const queue: unknown[] = [];
  let resolver: ((result: IteratorResult<unknown>) => void) | null = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
    if (resolver) {
      const pending = resolver;
      resolver = null;
      pending({ done: true, value: undefined });
    }
  };
  const onAbort = () => close();
  signal.addEventListener("abort", onAbort, { once: true });

  source.onmessage = (event: MessageEvent) => {
    if (closed) return;
    try {
      const text = typeof event.data === "string" ? event.data : String(event.data);
      const parsed = JSON.parse(text) as unknown;
      if (resolver) {
        const pending = resolver;
        resolver = null;
        pending({ done: false, value: parsed });
      } else {
        queue.push(parsed);
      }
    } catch {
      // Ignore non-JSON frames (keepalive comments, partial events).
    }
  };

  try {
    while (!closed) {
      if (queue.length > 0) {
        yield queue.shift();
        continue;
      }
      const result = await new Promise<IteratorResult<unknown>>((resolve) => {
        resolver = resolve;
      });
      if (result.done) break;
      yield result.value;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    source.close();
  }
}
