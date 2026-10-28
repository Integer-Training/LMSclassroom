// The single server-side path from a user id to an authorization Actor.
//
// Reads role (organizationmember.roleId) + status (profile.status) FRESH — not from the
// cookie-cached session — so a role change or a deactivation takes effect on the very next
// request, and a live session of a deactivated user is denied everywhere at once. The pure
// decision logic lives in @cio/utils/auth (buildActor); this file only does the DB read.
//
// The read goes through getUserMembershipRows: ONE query per request (memoised for that request only, shared
// with the better-auth customSession), never across requests.

import { getUserMembershipRows } from './request-memo';
import { buildActor, ANONYMOUS_ACTOR, type Actor } from '@cio/utils/auth';

/**
 * Resolve the Actor for a user. When `orgId` is given, resolves the membership in that org;
 * otherwise resolves the user's single membership (PearlLMS operates one org; for a multi-org user the oldest
 * membership wins, deterministically). Returns the anonymous actor for a missing user id. Throws on a DB error.
 */
export async function resolveActor(userId: string | null | undefined, orgId?: string | null): Promise<Actor> {
  if (!userId) return ANONYMOUS_ACTOR;

  const rows = await getUserMembershipRows(userId);
  const row = orgId ? rows.find((r) => r.orgId === orgId) : rows.find((r) => r.orgId !== null);

  return buildActor({
    userId,
    orgId: row?.orgId ?? null,
    roleId: row?.roleId ?? null,
    status: row?.status ?? null
  });
}

export { type Actor, ANONYMOUS_ACTOR } from '@cio/utils/auth';
