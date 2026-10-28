import { parseTtlMs } from '@cio/utils/cache';

// Single-flight + stale-while-revalidate cache for the heavy ADMIN/MANAGER report reads (PearlLMS scalability H1).
//
// - Concurrent callers of the same key share ONE in-flight load (single-flight): N admins refreshing a report cost one
//   run of its queries, not N.
// - A value younger than `ttlMs` is served as-is. A value older than that but still inside `staleMs` is served
//   IMMEDIATELY while ONE background refresh runs (stale-while-revalidate), so a page never waits on a recompute it
//   already has an answer for. Older than ttl+stale -> the caller waits on a fresh single-flight load.
// - Loader errors are never cached; a failed background refresh keeps the stale value and the next caller retries.
// - Bounded (oldest entry evicted past `maxEntries`).
//
// SECURITY: this caches org-wide REPORT data only, keyed `<report>:<orgId>`. It is NEVER used for authorization or for
// per-tutor / per-actor views — callers run their role guard (requireAdmin / requireManagerOrAdmin + same-org) BEFORE
// the cache read, and a cache entry never grants or withholds access (docs/ACCESS.md §8). Tutor views (allocation
// scoped) must not use it.

export interface SwrCacheOptions {
  maxEntries?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Entry<V> {
  value: V;
  at: number;
}

export class SwrCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();
  private generation = 0;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: SwrCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 200;
    this.now = options.now ?? (() => Date.now());
  }

  /** `ttlMs <= 0` disables caching entirely (pure single-flight) — the kill switch. */
  async get(key: string, loader: () => Promise<V>, ttlMs: number, staleMs: number): Promise<V> {
    if (ttlMs > 0) {
      const entry = this.entries.get(key);
      if (entry) {
        const age = this.now() - entry.at;
        if (age < ttlMs) return entry.value;
        if (age < ttlMs + Math.max(0, staleMs)) {
          // Stale but usable: answer now, refresh once in the background (errors keep the stale value).
          void this.load(key, loader, ttlMs).catch((error) => {
            console.error(`swr-cache background refresh failed for ${key}:`, error);
          });
          return entry.value;
        }
        this.entries.delete(key);
      }
    }
    return this.load(key, loader, ttlMs);
  }

  clear(): void {
    this.entries.clear();
    this.generation++;
  }

  get size(): number {
    return this.entries.size;
  }

  private load(key: string, loader: () => Promise<V>, ttlMs: number): Promise<V> {
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const generation = this.generation;
    // Promise.resolve().then(loader) also turns a synchronous loader throw into a rejection (never cached).
    const promise: Promise<V> = Promise.resolve()
      .then(loader)
      .then((value) => {
        if (ttlMs > 0 && generation === this.generation) {
          this.entries.delete(key);
          this.entries.set(key, { value, at: this.now() });
          while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
          }
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_STALE_MS = 240_000;

/** Fresh window for the dashboard report caches. DASH_CACHE_TTL_MS overrides; "0" disables the cache (kill switch). */
export function dashCacheTtlMs(): number {
  return parseTtlMs(process.env.DASH_CACHE_TTL_MS, DEFAULT_TTL_MS);
}

/** How long past the TTL a stale report may still be served while it refreshes. DASH_CACHE_STALE_MS overrides. */
export function dashCacheStaleMs(): number {
  return parseTtlMs(process.env.DASH_CACHE_STALE_MS, DEFAULT_STALE_MS);
}

const reportCache = new SwrCache<unknown>({ maxEntries: 200 });

/**
 * Org-keyed report read: `report` names the endpoint, `orgId` the tenant. ONLY for Admin/Manager org-wide reports,
 * called AFTER the role guard. The key never contains an actor id, so never route a tutor/learner view through it.
 */
export function cachedOrgReport<V>(report: string, orgId: string, loader: () => Promise<V>): Promise<V> {
  return reportCache.get(
    `${report}:${orgId}`,
    loader as () => Promise<unknown>,
    dashCacheTtlMs(),
    dashCacheStaleMs()
  ) as Promise<V>;
}

/** Drop every cached report (tests / operational use). */
export function clearDashReportCache(): void {
  reportCache.clear();
}
