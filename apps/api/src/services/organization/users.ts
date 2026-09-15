import { randomBytes } from 'crypto';

import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { auth } from '@cio/db/auth';

// The admin plugin server methods exist at runtime but aren't surfaced on the inferred `auth.api` type
// (better-auth/minimal). Narrow, local typing for just what we call.
const authApi = auth.api as unknown as {
  createUser: (args: {
    body: { email: string; name: string; password: string; role?: string };
  }) => Promise<{ user?: { id?: string } }>;
  setUserPassword: (args: { body: { userId: string; newPassword: string } }) => Promise<unknown>;
};
import {
  countActiveOrgAdmins,
  createOrganizationMember,
  deleteSessionsByUserId,
  getOrganizationMemberByIdAndOrg,
  getOrganizationUsers,
  getUserOrgRolesMap,
  type GetOrganizationUsersOptions
} from '@cio/db/queries/organization';
import {
  getLearnerProfileByUserId,
  upsertLearnerProfile,
  type LearnerProfileFields
} from '@cio/db/queries/learner-profile';
import { updateOrganizationMemberById } from '@cio/db/queries/organization/invite';
import { markUserAndProfileEmailVerified, updateProfile } from '@cio/db/queries/auth';
import { getProfileById } from '@cio/db/queries/auth';
import { db } from '@cio/db/drizzle';
import { recordAudit, AUDIT_ACTIONS } from '@cio/db/audit';
import { ROLE, roleIdToName } from '@cio/utils/constants';

type MemberStatus = 'ACTIVE' | 'DEACTIVATED';

// Ambiguous characters (0/O/1/l/I) removed so a hand-copied temporary password isn't misread.
const PW_LOWER = 'abcdefghijkmnpqrstuvwxyz';
const PW_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PW_DIGIT = '23456789';
const PW_SPECIAL = '!@#$%*?-';

function pick(set: string): string {
  return set[randomBytes(1)[0] % set.length];
}

/**
 * A readable 12-char temporary password that satisfies the policy (≥10, upper+lower+digit+special).
 * Admin-created accounts get this REVEALED once to the admin (email delivery is dormant), and are flagged
 * `mustChangePassword` so the learner/tutor is forced to set their own on first login.
 */
export function generateTemporaryPassword(): string {
  const all = PW_LOWER + PW_UPPER + PW_DIGIT;
  let core = '';
  for (let i = 0; i < 8; i++) core += pick(all);
  return pick(PW_UPPER) + pick(PW_LOWER) + core + pick(PW_DIGIT) + pick(PW_SPECIAL);
}

/** List/search users in an org across all roles, with role + account status. */
export async function listOrgUsers(orgId: string, options: GetOrganizationUsersOptions) {
  return getOrganizationUsers(orgId, options);
}

/**
 * Provision a new account (the ONLY account-creation door — public sign-up is disabled, Step 6):
 * create the Better Auth user + credential account (random password) → the create.after hook makes
 * the profile → add the org membership → email a set-password link. Audits user.created.
 */
export async function createOrgUser(
  orgId: string,
  actor: Actor,
  input: { name: string; email: string; roleId: number }
): Promise<{ userId: string; roleId: number; temporaryPassword: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  // A readable temporary password, REVEALED once to the admin (email delivery is dormant). The account is
  // flagged mustChangePassword so the user must set their own on first login.
  const temporaryPassword = generateTemporaryPassword();

  let newUserId: string;
  try {
    // Called WITHOUT the admin's headers on purpose: this route is already requireAdmin-gated, and
    // Better Auth's admin.createUser permission check keys on its own user.role (not our org role),
    // so a header-less server call is the intended provisioning path.
    const created = await authApi.createUser({
      body: { email, name, password: temporaryPassword, role: 'user' }
    });

    const id = created?.user?.id;
    if (!id) {
      throw new AppError('User creation returned no id', ErrorCodes.INTERNAL_ERROR, 500);
    }
    newUserId = id;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (/exist|unique|duplicate/i.test(message)) {
      throw new AppError('A user with this email already exists', ErrorCodes.CONFLICT, 409);
    }
    console.error('createOrgUser: createUser failed:', message);
    throw new AppError('Failed to create user', ErrorCodes.INTERNAL_ERROR, 500);
  }

  await createOrganizationMember({
    organizationId: orgId,
    profileId: newUserId,
    roleId: input.roleId,
    email,
    verified: true
  });

  // Closed system: an admin-provisioned account is trusted — there is no self-signup, and email
  // verification can't complete while SMTP is dormant. Mark it verified so the learner/tutor isn't nagged
  // forever by the "Verify your email" modal.
  await markUserAndProfileEmailVerified(newUserId);

  // Force a password change on first login (the admin hands over the revealed temp password). Merged into
  // profile.settings (updateProfile merges settings, never overwrites).
  await updateProfile(newUserId, { settings: { mustChangePassword: true } });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: 'user',
    entityId: newUserId,
    metadata: { role: input.roleId } // id only, never name/email
  });

  return { userId: newUserId, roleId: input.roleId, temporaryPassword };
}

/** Resolve an org member row (scoped to the org) or throw 404. */
async function resolveMember(orgId: string, memberId: number) {
  const member = await getOrganizationMemberByIdAndOrg(memberId, orgId);
  if (!member) {
    throw new AppError('User not found in this organization', ErrorCodes.NOT_FOUND, 404);
  }
  return member;
}

/** Change an org member's role. resolveActor reads it fresh → effect on the user's next request. */
export async function changeOrgUserRole(orgId: string, actor: Actor, memberId: number, roleId: number) {
  const member = await resolveMember(orgId, memberId);
  const currentRoleId = await currentMemberRoleId(orgId, member.profileId);

  if (currentRoleId === roleId) {
    return { userId: member.profileId, roleId };
  }

  // Don't strand the org without an admin, and don't let an admin demote themselves out of access.
  if (currentRoleId === ROLE.ADMIN && roleId !== ROLE.ADMIN) {
    if (actor.authenticated && actor.userId === member.profileId) {
      throw new AppError('You cannot change your own admin role', ErrorCodes.FORBIDDEN, 403);
    }
    if ((await countActiveOrgAdmins(orgId)) <= 1) {
      throw new AppError('The organization must keep at least one admin', ErrorCodes.FORBIDDEN, 403);
    }
  }

  await updateOrganizationMemberById(db, memberId, { roleId });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
    entityType: 'user',
    entityId: member.profileId,
    metadata: { role_from: currentRoleId ?? null, role_to: roleId }
  });

  return { userId: member.profileId, roleId };
}

/**
 * Deactivate/reactivate a user (profile.status). On DEACTIVATED the user's live sessions are deleted
 * so the effect bites immediately (next request 401), the session.create.before hook blocks re-login,
 * and resolveActor denies. Audits user.status_changed.
 */
export async function changeOrgUserStatus(orgId: string, actor: Actor, memberId: number, status: MemberStatus) {
  const member = await resolveMember(orgId, memberId);
  if (!member.profileId) {
    throw new AppError('This member has no account yet', ErrorCodes.NOT_FOUND, 404);
  }

  const profile = await getProfileById(member.profileId);
  const fromStatus: MemberStatus = (profile?.status as MemberStatus) ?? 'ACTIVE';
  if (fromStatus === status) {
    return { userId: member.profileId, status };
  }

  if (status === 'DEACTIVATED') {
    if (actor.authenticated && actor.userId === member.profileId) {
      throw new AppError('You cannot deactivate your own account', ErrorCodes.FORBIDDEN, 403);
    }
    const roleId = await currentMemberRoleId(orgId, member.profileId);
    if (roleId === ROLE.ADMIN && (await countActiveOrgAdmins(orgId)) <= 1) {
      throw new AppError('The organization must keep at least one active admin', ErrorCodes.FORBIDDEN, 403);
    }
  }

  await updateProfile(member.profileId, { status });

  if (status === 'DEACTIVATED') {
    // Kill live sessions so the deactivation bites on the very next request, not in ≤1h.
    await deleteSessionsByUserId(member.profileId);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    entityType: 'user',
    entityId: member.profileId,
    metadata: { status_from: fromStatus, status_to: status }
  });

  return { userId: member.profileId, status };
}

/**
 * Admin: reset a member's password to a fresh readable temp password (revealed once), force a change on
 * next login, and kill live sessions so the old password stops working immediately. This is the "Send login"
 * action in a closed system where email can't deliver a reset link — the admin hands the password over.
 */
export async function resetUserPassword(
  orgId: string,
  actor: Actor,
  memberId: number
): Promise<{ userId: string; temporaryPassword: string }> {
  const userId = await resolveMemberUserId(orgId, memberId);
  const temporaryPassword = generateTemporaryPassword();

  try {
    await authApi.setUserPassword({ body: { userId, newPassword: temporaryPassword } });
  } catch (error) {
    console.error('resetUserPassword: setUserPassword failed:', error);
    throw new AppError('Failed to reset password', ErrorCodes.INTERNAL_ERROR, 500);
  }

  await updateProfile(userId, { settings: { mustChangePassword: true } });
  await deleteSessionsByUserId(userId); // old sessions can no longer act; user re-logs in with the new pw

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    entityType: 'user',
    entityId: userId,
    metadata: { password_reset: true }
  });

  return { userId, temporaryPassword };
}

/** Fetch a member's current roleId in this org (for from→to audit + the last-admin guards). */
async function currentMemberRoleId(orgId: string, profileId: string | null): Promise<number | null> {
  if (!profileId) return null;
  const roles = await getUserOrgRolesMap(profileId);
  return roles[orgId] ?? null;
}

// ── Enrolment PII (Admin-only) ───────────────────────────────────────────────────────────────
// The nine PII fields, and their snake_case audit names. PII VALUES are never logged or put in
// audit metadata — only the NAMES of fields that changed.
const PII_FIELDS: Array<{ key: keyof LearnerProfileFields; name: string }> = [
  { key: 'dateOfBirth', name: 'date_of_birth' },
  { key: 'niNumber', name: 'ni_number' },
  { key: 'gender', name: 'gender' },
  { key: 'ethnicity', name: 'ethnicity' },
  { key: 'disability', name: 'disability' },
  { key: 'address', name: 'address' },
  { key: 'aebRegion', name: 'aeb_region' },
  { key: 'collegeRef', name: 'college_ref' },
  { key: 'notes', name: 'notes' }
];

/** Resolve a member to its userId (throws 404 if absent or profile-less). */
async function resolveMemberUserId(orgId: string, memberId: number): Promise<string> {
  const member = await resolveMember(orgId, memberId);
  if (!member.profileId) {
    throw new AppError('This member has no account yet', ErrorCodes.NOT_FOUND, 404);
  }
  return member.profileId;
}

/** Admin-only: read a learner's PII (all-null shape when no row exists yet). */
export async function getLearnerProfile(orgId: string, memberId: number): Promise<LearnerProfileFields> {
  const userId = await resolveMemberUserId(orgId, memberId);
  const row = await getLearnerProfileByUserId(userId);
  return {
    dateOfBirth: row?.dateOfBirth ?? null,
    niNumber: row?.niNumber ?? null,
    gender: row?.gender ?? null,
    ethnicity: row?.ethnicity ?? null,
    disability: row?.disability ?? null,
    address: row?.address ?? null,
    aebRegion: row?.aebRegion ?? null,
    collegeRef: row?.collegeRef ?? null,
    notes: row?.notes ?? null
  };
}

/**
 * Admin-only: upsert a learner's PII and audit `profile.updated` with the NAMES of the fields that
 * actually changed (never the values). PII values are not logged.
 */
export async function updateLearnerProfile(orgId: string, actor: Actor, memberId: number, input: LearnerProfileFields) {
  const userId = await resolveMemberUserId(orgId, memberId);
  const existing = await getLearnerProfileByUserId(userId);

  const changedFields = PII_FIELDS.filter(({ key }) => (existing?.[key] ?? null) !== (input[key] ?? null)).map(
    ({ name }) => name
  );

  await upsertLearnerProfile(userId, input);

  if (changedFields.length > 0) {
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.PROFILE_UPDATED,
      entityType: 'profile',
      entityId: userId,
      metadata: { fields: changedFields } // field NAMES only — never values
    });
  }

  return { userId, changed: changedFields.length };
}

export const _roleName = roleIdToName; // re-export convenience (kept for callers/tests)
