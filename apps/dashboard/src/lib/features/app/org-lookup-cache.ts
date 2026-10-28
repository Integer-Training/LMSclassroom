import { TtlCache } from '@cio/utils/cache';

// PearlLMS scalability Phase C1 — the root layout resolved the org (branding, plan) from the API on EVERY page
// navigation. This is public branding data, not authorization, so a short per-process cache is safe.
//
//  - Keyed by `mode|siteName|hostname` so tenants (subdomains / custom domains) never cross.
//  - Concurrent lookups share one in-flight request (single-flight), even when the TTL is 0.
//  - An empty answer (null / []) or an API blip is cached for at most ~2s, so a brief API failure cannot leave the
//    login page stuck with no org. Thrown errors are never cached.
//  - ORG_CACHE_TTL_MS=0 disables the cache (kill switch); default 60s.

export const DEFAULT_ORG_LOOKUP_TTL_MS = 60_000;
export const EMPTY_ORG_LOOKUP_TTL_MS = 2_000;

const cache = new TtlCache<unknown>({ maxEntries: 200 });

function isEmptyAnswer(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

export function orgLookupKey(mode: 'self-hosted' | 'site' | 'domain', siteName = '', hostname = ''): string {
  return `${mode}|${siteName}|${hostname}`;
}

/** Cached org lookup. Returns a clone so a consumer can never mutate the shared copy. */
export async function cachedOrgLookup<T>(key: string, loader: () => Promise<T>, ttlMs: number): Promise<T> {
  const value = (await cache.getOrLoad(key, loader, (result) =>
    isEmptyAnswer(result) ? Math.min(ttlMs, EMPTY_ORG_LOOKUP_TTL_MS) : ttlMs
  )) as T;

  return isEmptyAnswer(value) ? value : structuredClone(value);
}

export function clearOrgLookupCache(): void {
  cache.clear();
}
