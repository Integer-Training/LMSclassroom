import { buildActor, ANONYMOUS_ACTOR, type Actor } from '@cio/utils/auth';

// The dashboard's single session → Actor path. Builds the authorization identity from
// the session the API already returns (customSession: user + orgRoles + status) — no DB
// hop. The API's resolveActor is the authoritative enforcement boundary (fresh read);
// this actor drives UI and is backed by that enforcement.

type SessionLike = {
  user?: { id?: string | null } | null;
  orgRoles?: Record<string, number> | null;
  status?: string | null;
} | null;

export function getActor(session: SessionLike): Actor {
  if (!session?.user?.id) return ANONYMOUS_ACTOR;
  const orgRoles = session.orgRoles ?? {};
  // PearlLMS operates one org → the user's single membership.
  const orgId = Object.keys(orgRoles)[0] ?? null;
  const roleId = orgId ? orgRoles[orgId] : null;
  return buildActor({
    userId: session.user.id,
    orgId,
    roleId,
    status: session.status ?? 'ACTIVE'
  });
}

export { type Actor, ANONYMOUS_ACTOR };
