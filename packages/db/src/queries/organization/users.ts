import * as schema from '@db/schema';

import bcrypt from 'bcrypt';
import { and, count, desc, eq, ilike, or } from 'drizzle-orm';

import { db } from '@db/drizzle';

// Admin user-management queries (Phase 1 Step 7). Lists org members across ALL roles joined to their
// profile so the admin sees role + account status together (nothing existing returns both).

export interface GetOrganizationUsersOptions {
  page?: number;
  limit?: number;
  search?: string;
  role?: number;
  status?: 'ACTIVE' | 'DEACTIVATED';
}

export interface OrganizationUserRow {
  memberId: number;
  userId: string | null;
  name: string;
  email: string;
  roleId: number;
  status: 'ACTIVE' | 'DEACTIVATED' | null;
  verified: boolean;
}

export async function getOrganizationUsers(orgId: string, options: GetOrganizationUsersOptions = {}) {
  const page = options.page && options.page > 0 ? options.page : 1;
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 20;
  const offset = (page - 1) * limit;
  const search = options.search?.trim();

  const conditions = [eq(schema.organizationmember.organizationId, orgId)];
  if (options.role != null) {
    conditions.push(eq(schema.organizationmember.roleId, options.role));
  }
  if (options.status) {
    conditions.push(eq(schema.profile.status, options.status));
  }
  if (search) {
    const value = `%${search}%`;
    conditions.push(
      or(
        ilike(schema.profile.fullname, value),
        ilike(schema.profile.email, value),
        ilike(schema.organizationmember.email, value)
      )!
    );
  }

  const whereClause = and(...conditions);

  const [totalRow] = await db
    .select({ count: count(schema.organizationmember.id) })
    .from(schema.organizationmember)
    .leftJoin(schema.profile, eq(schema.organizationmember.profileId, schema.profile.id))
    .where(whereClause);
  const total = Number(totalRow?.count ?? 0);

  const rows = await db
    .select({
      memberId: schema.organizationmember.id,
      userId: schema.profile.id,
      fullname: schema.profile.fullname,
      profileEmail: schema.profile.email,
      memberEmail: schema.organizationmember.email,
      roleId: schema.organizationmember.roleId,
      status: schema.profile.status,
      verified: schema.organizationmember.verified
    })
    .from(schema.organizationmember)
    .leftJoin(schema.profile, eq(schema.organizationmember.profileId, schema.profile.id))
    .where(whereClause)
    .orderBy(desc(schema.organizationmember.id))
    .limit(limit)
    .offset(offset);

  const items: OrganizationUserRow[] = rows.map((row) => {
    const email = (row.profileEmail || row.memberEmail || '').trim();
    const name = row.fullname?.trim() || (email.includes('@') ? email.split('@')[0] : email) || '';
    return {
      memberId: row.memberId,
      userId: row.userId ?? null,
      name,
      email,
      roleId: Number(row.roleId),
      status: (row.status as 'ACTIVE' | 'DEACTIVATED' | null) ?? null,
      verified: Boolean(row.verified)
    };
  });

  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Delete all of a user's sessions — used on deactivation so the live session dies immediately. */
export async function deleteSessionsByUserId(userId: string): Promise<void> {
  await db.delete(schema.session).where(eq(schema.session.userId, userId));
}

/**
 * Bump a session's `updated_at` to now — the live-presence signal the "Online now" panel reads
 * (it counts sessions refreshed within N minutes). Called by the client heartbeat.
 */
export async function touchSession(sessionId: string): Promise<void> {
  await db.update(schema.session).set({ updatedAt: new Date() }).where(eq(schema.session.id, sessionId));
}

/**
 * Set a user's password directly on their credential account (bcrypt cost 10 — matches the better-auth
 * password.hash config, so the new password verifies on login). Update the existing credential row, or create
 * one if absent. This is the admin password-RESET path: better-auth's admin `setUserPassword` endpoint
 * requires the caller to be a *better-auth* admin (user.role='admin'), which org admins are NOT, so it returns
 * UNAUTHORIZED — this direct write is the reliable equivalent (same approach as scripts/set-password.ts).
 */
export async function setCredentialPassword(userId: string, plainPassword: string): Promise<void> {
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const [existing] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, 'credential')))
    .limit(1);
  if (existing) {
    await db.update(schema.account).set({ password: passwordHash }).where(eq(schema.account.id, existing.id));
  } else {
    await db
      .insert(schema.account)
      .values({ userId, providerId: 'credential', accountId: userId, password: passwordHash });
  }
}

/** Count ACTIVE admins in an org — for the "don't remove the last admin" guard. */
export async function countActiveOrgAdmins(orgId: string): Promise<number> {
  const [row] = await db
    .select({ count: count(schema.organizationmember.id) })
    .from(schema.organizationmember)
    .innerJoin(schema.profile, eq(schema.organizationmember.profileId, schema.profile.id))
    .where(
      and(
        eq(schema.organizationmember.organizationId, orgId),
        eq(schema.organizationmember.roleId, 1),
        eq(schema.profile.status, 'ACTIVE')
      )
    );
  return Number(row?.count ?? 0);
}
