import { error, redirect } from '@sveltejs/kit';
import { isRole, isSelf, sameOrg, type Actor } from '@cio/utils/auth';
import type { Role } from '@cio/utils/constants';

// Dashboard server-side authorization guards.
//
// These are the SvelteKit-side adapters over the SAME pure predicates the API uses
// (@cio/utils/auth) — the decision logic is not forked, only the control flow is: anonymous ->
// redirect to login, wrong role/owner -> 403. Call them from +layout.server.ts / +page.server.ts
// loads. `locals.actor` is populated per request in getSessionData() via getActor().
//
// The API (Step 4) remains the authoritative enforcement boundary; these guards stop the admin
// shell/nav from rendering for the wrong role and keep each role on a permitted screen.

type GuardLocals = { actor?: Actor };

/** Any authenticated, active member. Anonymous/deactivated -> login. Returns the Actor. */
export function requireActor(locals: GuardLocals): Extract<Actor, { authenticated: true }> {
  const actor = locals.actor;
  if (!actor?.authenticated) {
    throw redirect(303, '/login');
  }
  return actor;
}

/** Authenticated AND holding one of the given roles. Wrong role -> 403. */
export function requireRole(locals: GuardLocals, ...roles: Role[]): Extract<Actor, { authenticated: true }> {
  const actor = requireActor(locals);
  if (!isRole(actor, ...roles)) {
    throw error(403, 'You do not have permission to view this page');
  }
  return actor;
}

/** Admin only — the org admin surface, config, authoring, user management. */
export function requireAdmin(locals: GuardLocals) {
  return requireRole(locals, 'ADMIN');
}

/** Admin or Tutor. (Tutor per-learner access is allocation-gated at the API until Phase 3.) */
export function requireStaff(locals: GuardLocals) {
  return requireRole(locals, 'ADMIN', 'TUTOR');
}

/** Admin or Manager — provider-wide read surfaces (features arrive Phase 5). */
export function requireManagerOrAdmin(locals: GuardLocals) {
  return requireRole(locals, 'MANAGER', 'ADMIN');
}

/** The caller may only act on their own record (Admin may be allowed via orAdmin). */
export function requireSelf(locals: GuardLocals, targetUserId: string | null | undefined) {
  const actor = requireActor(locals);
  if (isSelf(actor, targetUserId) || actor.role === 'ADMIN') {
    return actor;
  }
  throw error(403, 'You can only access your own data');
}

/** The resolved org must match the actor's org (closes slug-trust cross-org). No-op if orgId null. */
export function requireSameOrg(locals: GuardLocals, orgId: string | null | undefined) {
  const actor = requireActor(locals);
  if (orgId && !sameOrg(actor, orgId)) {
    throw error(403, 'This workspace belongs to a different organization');
  }
  return actor;
}
