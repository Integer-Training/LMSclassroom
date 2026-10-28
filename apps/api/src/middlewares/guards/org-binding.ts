import { Context, Next } from 'hono';

import type { Actor } from '@cio/db/actor';
import { isOrgAdminByCohortId } from '@cio/db/queries/cohort';
import { getCourseOrgId } from '@cio/db/queries/reports';
import { notFound } from '@api/middlewares/guards/ownership';
import { forbidden, unauthorized } from '@api/middlewares/guards/require-role';

// Binds the :courseId / :cohortId path param to the actor's RESOLVED org. requireAdmin alone only proves the
// caller is an admin SOMEWHERE; these make an admin of org A unable to act on org B's course/cohort.

/** The `:courseId` path param (or `courseParam`) must belong to the actor's org; else 404 (no existence leak). */
export function requireCourseInOrg(courseParam = 'courseId') {
  return async (c: Context, next: Next) => {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor?.authenticated) return unauthorized(c);

    const courseId = c.req.param(courseParam);
    const orgId = courseId ? await getCourseOrgId(courseId) : null;
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
