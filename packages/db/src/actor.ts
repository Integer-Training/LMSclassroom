// The single server-side path from a user id to an authorization Actor.
//
// Reads role (organizationmember.roleId) + status (profile.status) FRESH — not from the
// cookie-cached session — so a role change or a deactivation takes effect on the very next
// request, and a live session of a deactivated user is denied everywhere at once. The pure
// decision logic lives in @cio/utils/auth (buildActor); this file only does the DB read.

import { and, eq } from 'drizzle-orm';
import { db } from './drizzle';
import { organizationmember, profile } from './schema';
import { buildActor, ANONYMOUS_ACTOR, type Actor } from '@cio/utils/auth';

/**
 * Resolve the Actor for a user. When `orgId` is given, resolves the membership in that org;
 * otherwise resolves the user's single membership (PearlLMS operates one org). Returns the
 * anonymous actor for a missing user id.
 */
export async function resolveActor(userId: string | null | undefined, orgId?: string | null): Promise<Actor> {
  if (!userId) return ANONYMOUS_ACTOR;

  const rows = await db
    .select({
      roleId: organizationmember.roleId,
      orgId: organizationmember.organizationId,
      status: profile.status
    })
    .from(organizationmember)
    .innerJoin(profile, eq(profile.id, organizationmember.profileId))
    .where(
      orgId
        ? and(eq(organizationmember.profileId, userId), eq(organizationmember.organizationId, orgId))
        : eq(organizationmember.profileId, userId)
    )
    .limit(1);

  const row = rows[0];
  return buildActor({
    userId,
    orgId: row?.orgId ?? null,
    roleId: row?.roleId ?? null,
    status: row?.status ?? null
  });
}

export { type Actor, ANONYMOUS_ACTOR } from '@cio/utils/auth';
