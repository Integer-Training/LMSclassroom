// Per-REQUEST identity memo (PearlLMS scalability Phase C4).
//
// One request used to pay for the user's membership/role/status up to three times (customSession: org roles +
// profile status; resolveActor: membership join; and again for /api/auth/get-session). This reads them with ONE
// `profile LEFT JOIN organizationmember` query and memoises the rows for the lifetime of the current request only,
// via AsyncLocalStorage (app.ts opens the scope per request with runWithRequestMemo).
//
// This is NOT a cache across requests. The scope is discarded when the request ends, and outside a scope (jobs,
// scripts, tests) every call queries fresh — so deactivation and role changes take effect on the very next request
// (docs/ACCESS.md §8). Never widen this to a TTL cache.

import { AsyncLocalStorage } from 'node:async_hooks';
import { asc, eq } from 'drizzle-orm';
import { db } from './drizzle';
import { organizationmember, profile } from './schema';

export interface UserMembershipRow {
  /** Null only for a user that has a profile but no membership at all. */
  orgId: string | null;
  roleId: number | null;
  /** profile.status (ACTIVE | DEACTIVATED), null if the column is null. */
  status: string | null;
}

type RequestMemo = Map<string, Promise<UserMembershipRow[]>>;

const scope = new AsyncLocalStorage<RequestMemo>();

/** Run `fn` inside a fresh per-request memo scope. Everything awaited inside shares the scope. */
export function runWithRequestMemo<T>(fn: () => T): T {
  return scope.run(new Map(), fn);
}

async function queryUserMembershipRows(userId: string): Promise<UserMembershipRow[]> {
  const rows = await db
    .select({
      orgId: organizationmember.organizationId,
      roleId: organizationmember.roleId,
      status: profile.status
    })
    .from(profile)
    .leftJoin(organizationmember, eq(organizationmember.profileId, profile.id))
    .where(eq(profile.id, userId))
    // Deterministic order for multi-org users (the "first" membership is the oldest one).
    .orderBy(asc(organizationmember.createdAt), asc(organizationmember.id));

  return rows.map((row) => ({
    orgId: row.orgId ?? null,
    roleId: row.roleId == null ? null : Number(row.roleId),
    status: row.status ?? null
  }));
}

/**
 * The user's memberships (oldest first) with the profile status, read FRESH from the DB — memoised only within the
 * current request scope. Throws on a DB error: callers must fail closed (never treat an error as "no roles").
 * An unknown user id yields an empty array.
 */
export function getUserMembershipRows(userId: string): Promise<UserMembershipRow[]> {
  const memo = scope.getStore();
  if (!memo) return queryUserMembershipRows(userId);

  const existing = memo.get(userId);
  if (existing) return existing;

  const pending = queryUserMembershipRows(userId);
  memo.set(userId, pending);
  // A failed read must not be replayed to later callers in the same request.
  pending.catch(() => {
    if (memo.get(userId) === pending) memo.delete(userId);
  });

  return pending;
}
