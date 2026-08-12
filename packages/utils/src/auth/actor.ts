// Pure actor logic (no DB). The single decision point for turning a resolved
// membership row into an authorization Actor. Deny-by-default: only an ACTIVE member
// with a known role is authenticated. Deactivated members are DENIED here, so a live
// session of a deactivated user fails everywhere the Actor is consulted.

import { roleIdToName, MEMBER_STATUS, type Role, type MemberStatus } from '../constants/roles';

export type Actor =
  | {
      authenticated: false;
      reason: 'anonymous' | 'deactivated' | 'no-membership' | 'unknown-role';
      userId?: string;
    }
  | {
      authenticated: true;
      userId: string;
      role: Role;
      status: 'ACTIVE';
      orgId: string;
    };

/** The anonymous (no session) actor. */
export const ANONYMOUS_ACTOR: Actor = { authenticated: false, reason: 'anonymous' };

export type MembershipInput = {
  userId: string | null | undefined;
  orgId: string | null | undefined;
  roleId: number | null | undefined;
  status: MemberStatus | string | null | undefined;
};

/**
 * Build an Actor from a resolved membership. Pure — the caller does the DB read.
 *  - no userId               → anonymous
 *  - deactivated status      → denied (reason: 'deactivated')
 *  - no membership row/org    → denied (reason: 'no-membership')
 *  - unrecognised roleId      → denied (reason: 'unknown-role')
 *  - active + known role      → authenticated
 */
export function buildActor(input: MembershipInput): Actor {
  if (!input.userId) {
    return { authenticated: false, reason: 'anonymous' };
  }
  if (input.status === MEMBER_STATUS.DEACTIVATED) {
    return { authenticated: false, reason: 'deactivated', userId: input.userId };
  }
  if (!input.orgId || input.roleId == null) {
    return { authenticated: false, reason: 'no-membership', userId: input.userId };
  }
  const role = roleIdToName(input.roleId);
  if (!role) {
    return { authenticated: false, reason: 'unknown-role', userId: input.userId };
  }
  return { authenticated: true, userId: input.userId, role, status: 'ACTIVE', orgId: input.orgId };
}

/** Convenience guards for consumers. */
export function isRole(actor: Actor, ...roles: Role[]): boolean {
  return actor.authenticated && roles.includes(actor.role);
}
