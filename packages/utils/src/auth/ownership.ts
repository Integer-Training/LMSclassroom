// Ownership & scope predicates — the ONE place that answers "may this actor touch this thing?".
// Pure (no DB, no request): they operate on the resolved Actor plus an id/scope the caller has
// already extracted. Route guards (apps/api) compose these; keeping them here makes every
// authorization decision unit-testable without a server or a database.
//
// Deny-by-default: every predicate returns false unless the actor is authenticated AND the rule
// is affirmatively satisfied. A deactivated / anonymous / no-membership actor (authenticated:false)
// fails all of them.

import type { Actor } from './actor';

/** The caller is acting on their own user record. */
export function isSelf(actor: Actor, targetUserId: string | null | undefined): boolean {
  return actor.authenticated && targetUserId != null && actor.userId === targetUserId;
}

/**
 * The caller is a tutor allocated to this learner.
 *
 * Phase 1: there is no allocation table yet (it arrives in Phase 3), so this ALWAYS denies.
 * This is the seam: a tutor can reach NO individual learner's data in Phase 1. Phase 3 replaces
 * the body with a lookup against the allocation table — the call-sites and tests do not change.
 */
export function isAllocatedTutor(actor: Actor, _learnerId: string | null | undefined): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void _learnerId;
  return false;
}

/** User management (create / invite / role change / deactivate) — Admin only. */
export function canManageUsers(actor: Actor): boolean {
  return actor.authenticated && actor.role === 'ADMIN';
}

/** System config / integrations — Admin only. Managers explicitly cannot reach config. */
export function canAccessConfig(actor: Actor): boolean {
  return actor.authenticated && actor.role === 'ADMIN';
}

/** Provider-wide read surfaces (reports, dashboards) — Admin or Manager. Features land Phase 5. */
export function isProviderWideReader(actor: Actor): boolean {
  return actor.authenticated && (actor.role === 'ADMIN' || actor.role === 'MANAGER');
}

/**
 * The target org matches the actor's resolved org. PearlLMS is single-org, so the authoritative
 * scope is `actor.orgId`; any client-supplied org id (header / ?orgId / body) must equal it.
 * This is what closes the cross-org `?orgId` / header-vs-query holes — authorization reads the
 * resolved org, never the client's claim.
 */
export function sameOrg(actor: Actor, targetOrgId: string | null | undefined): boolean {
  return actor.authenticated && targetOrgId != null && actor.orgId === targetOrgId;
}
