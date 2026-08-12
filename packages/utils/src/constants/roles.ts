// The ONE place role identifiers live. Schema, the actor resolver, guards, and UI
// all import from here — no role literals scattered elsewhere.
//
// PearlLMS has four roles. They reuse ClassroomIO's existing `role` table ids so the
// org-member role storage and multi-tenant structure stay intact:
//   Admin=1, Tutor=2, Learner=3 (== the legacy STUDENT id), Manager=4 (added Phase 1).

export const ROLE = {
  ADMIN: 1,
  TUTOR: 2,
  STUDENT: 3,
  LEARNER: 3,
  MANAGER: 4
} as const;

export type RoleId = 1 | 2 | 3 | 4;

/** Canonical PearlLMS role names. */
export type Role = 'ADMIN' | 'MANAGER' | 'TUTOR' | 'LEARNER';

/** roleId → canonical name. */
export const ROLE_NAME: Record<RoleId, Role> = {
  1: 'ADMIN',
  4: 'MANAGER',
  2: 'TUTOR',
  3: 'LEARNER'
};

export function roleIdToName(id: number | null | undefined): Role | null {
  if (id == null) return null;
  return ROLE_NAME[id as RoleId] ?? null;
}

/** Account/membership status. Deactivated users are denied at the actor resolver. */
export const MEMBER_STATUS = {
  ACTIVE: 'ACTIVE',
  DEACTIVATED: 'DEACTIVATED'
} as const;

export type MemberStatus = (typeof MEMBER_STATUS)[keyof typeof MEMBER_STATUS];
