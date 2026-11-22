/**
 * In-memory cache for composer capability lists (slash commands and skills).
 *
 * The caller supplies a key that identifies the workspace + engine generation,
 * so switching workspaces or reloading the engine selects a fresh slot. The
 * loader identity is deliberately not part of the key: split panes recreate
 * their loader callbacks on every render, but the capability list is the same.
 *
 * The cache exists so the composer can prefetch in the background and paint
 * the first `/` synchronously. Callers that need a fresh answer pass
 * `maxAgeMs: 0`; concurrent callers still share one in-flight request.
 */
type CapabilityCacheEntry = {
  value: unknown;
  fetchedAt: number;
  inflight: Promise<unknown> | null;
};

const MAX_CACHE_ENTRIES = 32;
const capabilityCache = new Map<string, CapabilityCacheEntry>();

function entryFor(key: string): CapabilityCacheEntry {
  const existing = capabilityCache.get(key);
  if (existing) return existing;
  if (capabilityCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = capabilityCache.keys().next().value;
    if (oldest !== undefined) capabilityCache.delete(oldest);
  }
  const entry: CapabilityCacheEntry = { value: null, fetchedAt: 0, inflight: null };
  capabilityCache.set(key, entry);
  return entry;
}

/** The last resolved value for a key, or null when nothing has resolved yet. */
export function readCachedCapability<T>(key: string | undefined): T | null {
  if (!key) return null;
  const entry = capabilityCache.get(key);
  if (!entry || entry.value === null) return null;
  return entry.value as T;
}

/**
 * Resolve a capability list, sharing in-flight work and reusing a fresh value.
 * `maxAgeMs` defaults to Infinity (cache for the key's lifetime); pass 0 to
 * revalidate while still painting the previous value via `readCachedCapability`.
 */
export function loadCachedCapability<T>(
  key: string | undefined,
  loader: () => Promise<T>,
  options?: { maxAgeMs?: number },
): Promise<T> {
  if (!key) return loader();
  const entry = entryFor(key);
  if (entry.inflight) return entry.inflight as Promise<T>;

  const maxAgeMs = options?.maxAgeMs ?? Number.POSITIVE_INFINITY;
  if (entry.value !== null && Date.now() - entry.fetchedAt < maxAgeMs) {
    return Promise.resolve(entry.value as T);
  }

  const request = loader()
    .then((value) => {
      entry.value = value;
      entry.fetchedAt = Date.now();
      return value;
    })
    .finally(() => {
      if (entry.inflight === request) entry.inflight = null;
    });
  entry.inflight = request;
  return request;
}

/** Drop one key, mainly for tests and explicit invalidation. */
export function clearCachedCapability(key: string | undefined): void {
  if (!key) return;
  capabilityCache.delete(key);
}
