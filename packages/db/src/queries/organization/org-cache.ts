// In-process cache for the "first organization" reads (PearlLMS scalability Phase C2).
//
// getFirstOrganization / getFirstOrganizationWithPlans were hit on every dashboard navigation, signup guard,
// profile read and registration (hundreds of thousands of identical queries). The org row is branding/plan data,
// NOT authorization — roles, status and allocation are never cached (docs/ACCESS.md §8).
//
// - TTL 30s by default; ORG_CACHE_TTL_MS=0 disables the cache entirely (kill switch), any other number overrides.
// - Concurrent callers share one in-flight read (single-flight), even with the TTL cache disabled.
// - Writers in this package (org update, plan writes, create/delete) call invalidateOrgCache(), so changes made
//   through this API process show immediately; the TTL bounds any other process/direct-SQL write.
// - A null ("no org yet", first-run) result is cached for at most 2s; errors are never cached.

import { TtlCache, parseTtlMs } from '@cio/utils/cache';

const DEFAULT_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 2_000;

const cache = new TtlCache<unknown>({ maxEntries: 16 });

function ttlMs(): number {
  return parseTtlMs(process.env.ORG_CACHE_TTL_MS, DEFAULT_TTL_MS);
}

/** Read through the cache. Returns a structured clone so callers can never mutate the cached copy. */
export async function cachedOrgRead<T>(key: string, loader: () => Promise<T | null>): Promise<T | null> {
  const ttl = ttlMs();
  const value = (await cache.getOrLoad(key, loader, (result) =>
    result === null || result === undefined ? Math.min(ttl, NEGATIVE_TTL_MS) : ttl
  )) as T | null;

  return value === null || value === undefined ? null : structuredClone(value);
}

/** Drop every cached org read. Call from any code path that writes organization / organization_plan rows. */
export function invalidateOrgCache(): void {
  cache.clear();
}
