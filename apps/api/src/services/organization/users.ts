import { randomBytes } from 'crypto';

import { AppError, ErrorCodes } from '@api/utils/errors';
import type { Actor } from '@cio/db/actor';
import { auth } from '@cio/db/auth';
import { env } from '@cio/core/config/env';

// The admin plugin + password-reset server methods exist at runtime but aren't surfaced on the
// inferred `auth.api` type (better-auth/minimal). Narrow, local typing for just what we call.
const authApi = auth.api as unknown as {
  createUser: (args: {
    body: { email: string; name: string; password: string; role?: string };
  }) => Promise<{ user?: { id?: string } }>;
  requestPasswordReset: (args: { body: { email: string; redirectTo?: string } }) => Promise<unknown>;
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
import { updateProfile } from '@cio/db/queries/auth';
import { getProfileById } from '@cio/db/queries/auth';
import { db } from '@cio/db/drizzle';
import { recordAudit, AUDIT_ACTIONS } from '@cio/db/audit';
import { ROLE, roleIdToName } from '@cio/utils/constants';

type MemberStatus = 'ACTIVE' | 'DEACTIVATED';

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
) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  // A throwaway password — the user sets their own via the reset link below. Never returned/logged.
  const tempPassword = `${randomBytes(24).toString('base64url')}Aa1!`;

  let newUserId: string;
  try {
    // Called WITHOUT the admin's headers on purpose: this route is already requireAdmin-gated, and
    // Better Auth's admin.createUser permission check keys on its own user.role (not our org role),
    // so a header-less server call is the intended provisioning path.
    const created = await authApi.createUser({
      body: { email, name, password: tempPassword, role: 'user' }
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

  // Set-password email (works despite disableSignUp). Best-effort — the account already exists.
  try {
    await authApi.requestPasswordReset({
      body: { email, redirectTo: `${env.DASHBOARD_ORIGIN ?? ''}/reset` }
    });
  } catch (error) {
    console.error('createOrgUser: set-password email failed (account still created):', error);
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_CREATED,
    entityType: 'user',
    entityId: newUserId,
    metadata: { role: input.roleId } // id only, never name/email
  });

  return { userId: newUserId, roleId: input.roleId };
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
