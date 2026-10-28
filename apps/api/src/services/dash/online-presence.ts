import { getCourseCounts, getMemberRoleStatusCounts, getOnlineOrgMembers } from '@cio/db/queries/dash';
import { TtlCache, parseTtlMs } from '@cio/utils/cache';

// PearlLMS scalability Phase D — per-org single-flight caches behind the two polled presence reads: the header
// "N online" pill (getOrgSummary, polled by every open admin tab) and the admin "Online now" panel (getOnlineNow).
//
// With N admin tabs open, each poll used to run the online-members join (+ the role/course counts) itself; now a
// poll inside the TTL window is served from memory and concurrent polls share ONE in-flight query.
//
// This is org-wide DISPLAY data (headcounts + who was recently active), NOT authorization: callers have already
// passed their own fresh per-request guard (requireAdmin / requireManagerOrAdmin + same-org) before reaching it,
// and a cache entry never grants or withholds access. Roles, status and allocation are never cached
// (docs/ACCESS.md §8). The only effect of staleness is a presence count/list up to one TTL out of date.
//
// - TTL 15s by default (the pollers run every ~45s, so a typical admin always gets fresh data, while a crowd
//   of tabs collapses to ~4 reads/min/org). PRESENCE_CACHE_TTL_MS overrides; "0" disables the cache (single-flight
//   still applies). ORG_CACHE_TTL_MS=0 (the shared Phase C kill switch) also disables it.
// - Keyed by organization id only, so tenants never cross. Loader errors are never cached.

const DEFAULT_TTL_MS = 15_000;
/** Matches the "Online now" window: a session refreshed within 5 minutes counts as online. */
export const ONLINE_WINDOW_MIN = 5;

type OnlineMembers = Awaited<ReturnType<typeof getOnlineOrgMembers>>;
type RoleCounts = Awaited<ReturnType<typeof getMemberRoleStatusCounts>>;
type CourseCounts = Awaited<ReturnType<typeof getCourseCounts>>;

export interface OrgCountsBundle {
  roleCounts: RoleCounts;
  courses: CourseCounts;
}

const onlineCache = new TtlCache<OnlineMembers>({ maxEntries: 200 });
const countsCache = new TtlCache<OrgCountsBundle>({ maxEntries: 200 });

function ttlMs(): number {
  if (parseTtlMs(process.env.ORG_CACHE_TTL_MS, 1) === 0) return 0;

  return parseTtlMs(process.env.PRESENCE_CACHE_TTL_MS, DEFAULT_TTL_MS);
}

/** Org members whose session was refreshed within the online window. Shared by the header pill and the panel. */
export function getCachedOnlineMembers(orgId: string): Promise<OnlineMembers> {
  return onlineCache.getOrLoad(
    orgId,
    () => getOnlineOrgMembers(orgId, ONLINE_WINDOW_MIN),
    () => ttlMs()
  );
}

/** Role/status and published/draft counts for the header summary (one grouped query each, shared per org). */
export function getCachedOrgCounts(orgId: string): Promise<OrgCountsBundle> {
  return countsCache.getOrLoad(
    orgId,
    async () => {
      const [roleCounts, courses] = await Promise.all([getMemberRoleStatusCounts(orgId), getCourseCounts(orgId)]);

      return { roleCounts, courses };
    },
    () => ttlMs()
  );
}

/** Drop the presence caches (tests / operational use). */
export function clearPresenceCaches(): void {
  onlineCache.clear();
  countsCache.clear();
}
