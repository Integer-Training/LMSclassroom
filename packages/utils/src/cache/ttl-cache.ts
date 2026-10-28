// Tiny in-process TTL cache with single-flight loading (PearlLMS scalability Phase C).
//
// Only for NON-authorization data (org branding/plan rows, course->org binding, OG renders). Authorization,
// allocation, role and status are NEVER cached across requests (docs/ACCESS.md §8, SCALABILITY-PLAN §3).
//
// - Concurrent loads of the same key share ONE in-flight promise (single-flight).
// - Loader errors are never cached; the next caller retries.
// - A delete()/clear() while a load is in flight stops that stale load from being stored.
// - Bounded: oldest entry is evicted past `maxEntries` (Map insertion order = LRU, refreshed on read).

export interface TtlCacheOptions {
  maxEntries?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();
  private generation = 0;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: TtlCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh recency.
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (!(ttlMs > 0)) {
      this.entries.delete(key);
      return;
    }

    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
    this.generation++;
  }

  clear(): void {
    this.entries.clear();
    this.generation++;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Return the cached value, or run `loader` once (shared by concurrent callers) and cache the result for
   * `ttlFor(value)` ms. `ttlFor` lets callers cache empty/negative results for a much shorter time (or 0 = not at all).
   * `ttlFor` returning 0 for every value, e.g. when the cache is disabled by env, makes this a pure single-flight.
   */
  async getOrLoad(key: string, loader: () => Promise<V>, ttlFor: (value: V) => number): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const generation = this.generation;
    // Promise.resolve().then(loader) also turns a synchronous loader throw into a rejection (never cached).
    const promise: Promise<V> = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (generation === this.generation) {
          this.set(key, value, ttlFor(value));
        }

        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, promise);

    return promise;
  }
}

/**
 * Parse a TTL (milliseconds) from a raw env string. Unset/blank/invalid -> `fallbackMs`; "0" (or negative) -> 0,
 * which callers treat as "cache disabled" (kill switch).
 */
export function parseTtlMs(raw: string | undefined | null, fallbackMs: number): number {
  if (raw === undefined || raw === null || raw.trim() === '') return fallbackMs;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallbackMs;

  return parsed > 0 ? Math.floor(parsed) : 0;
}
