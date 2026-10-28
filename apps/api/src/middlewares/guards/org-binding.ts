import { Context, Next } from 'hono';

import { TtlCache, parseTtlMs } from '@cio/utils/cache';
import type { Actor } from '@cio/db/actor';
import { isOrgAdminByCohortId } from '@cio/db/queries/cohort';
import { getCourseOrgId } from '@cio/db/queries/reports';
import { notFound } from '@api/middlewares/guards/ownership';
import { forbidden, unauthorized } from '@api/middlewares/guards/require-role';

// courseId -> owning orgId. A course never changes org, so this static binding is safe to remember (10 min,
// bounded LRU, evicted when the course is deleted). ONLY the binding is cached: whether the caller is a member /
// is allocated is decided per request from the fresh actor and is never cached (docs/ACCESS.md §8).
// COURSE_ORG_CACHE_TTL_MS (or the shared kill switch ORG_CACHE_TTL_MS=0) disables it. Misses are not cached.
const courseOrgCache = new TtlCache<string>({ maxEntries: 5000 });

function courseOrgCacheTtlMs(): number {
  if (parseTtlMs(process.env.ORG_CACHE_TTL_MS, 1) === 0) return 0;

  return parseTtlMs(process.env.COURSE_ORG_CACHE_TTL_MS, 10 * 60 * 1000);
}

async function lookupCourseOrgId(courseId: string): Promise<string | null> {
  const ttl = courseOrgCacheTtlMs();
  if (ttl === 0) return getCourseOrgId(courseId);

  const cached = courseOrgCache.get(courseId);
  if (cached) return cached;

  const orgId = await getCourseOrgId(courseId);
  if (orgId) courseOrgCache.set(courseId, orgId, ttl);

  return orgId;
}

/** Forget a course's cached org binding (call when the course is deleted). */
export function evictCourseOrgCache(courseId: string): void {
  courseOrgCache.delete(courseId);
}

/** Drop every cached binding (tests / operational use). */
export function clearCourseOrgCache(): void {
  courseOrgCache.clear();
}

// Binds the :courseId / :cohortId path param to the actor's RESOLVED org. requireAdmin alone only proves the
// caller is an admin SOMEWHERE; these make an admin of org A unable to act on org B's course/cohort.

/** The `:courseId` path param (or `courseParam`) must belong to the actor's org; else 404 (no existence leak). */
export function requireCourseInOrg(courseParam = 'courseId') {
  return async (c: Context, next: Next) => {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);

    const courseId = c.req.param(courseParam);
    const orgId = courseId ? await lookupCourseOrgId(courseId) : null;
    if (!orgId || orgId !== actor.orgId) return notFound(c);

    return next();
  };
}

/** The `:cohortId` path param must belong to an org the actor administers; else 403. */
export function requireCohortInOrg(cohortParam = 'cohortId') {
  return async (c: Context, next: Next) => {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);

    const cohortId = c.req.param(cohortParam);
    if (!cohortId || !(await isOrgAdminByCohortId(cohortId, actor.userId))) return forbidden(c);

    return next();
  };
}
