import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase E (nested-pool-in-invite-tx) — acceptStudentInvite must never touch the connection pool while its
// transaction is open: the IP-diversity read, both ACCEPTED audits and the capacity check all run on `tx`; the
// ABUSE_BLOCKED audit is written on the pool AFTER the transaction has rolled back.

const TX = { __tx: true } as const;
const events: string[] = [];

vi.mock('@cio/db/drizzle', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      events.push('tx:begin');
      try {
        const out = await fn(TX);
        events.push('tx:commit');
        return out;
      } catch (error) {
        events.push('tx:rollback');
        throw error;
      }
    })
  }
}));

vi.mock('@cio/db/queries/course/invite', () => ({
  countInviteDistinctPreviewIps: vi.fn(async () => 0),
  createCourseInvite: vi.fn(),
  createCourseInviteAudit: vi.fn(async (values: { eventType: string }, client: unknown) => {
    events.push(`audit:${values.eventType}:${client === TX ? 'tx' : 'pool'}`);
    return {};
  }),
  getCourseInviteById: vi.fn(),
  getCourseInviteByTokenHash: vi.fn(),
  listCourseInviteAudit: vi.fn(),
  listCourseInviteAuditStats: vi.fn(),
  listCourseInvites: vi.fn(),
  optimisticIncrementCourseInviteUsedCount: vi.fn(async () => ({ id: 'inv1' })),
  revokeCourseInvite: vi.fn(),
  selectCourseInviteAcceptBundleByTokenHash: vi.fn()
}));
vi.mock('@cio/db/queries/organization', () => ({
  createOrganizationMember: vi.fn(async () => ({})),
  getOrganizationMemberIdByOrgAndProfile: vi.fn(async () => null)
}));
vi.mock('@cio/db/queries/group', () => ({
  addGroupMember: vi.fn(async () => ({})),
  getGroupMemberIdByGroupAndProfile: vi.fn(async () => null)
}));
vi.mock('@cio/db/queries/course', () => ({
  getCourseById: vi.fn(),
  getCourseWithOrgData: vi.fn(),
  getCourseWithRelations: vi.fn(),
  isCourseSlugTaken: vi.fn(),
  updateCourseSlug: vi.fn()
}));
vi.mock('@cio/db/queries/auth', () => ({
  getProfileById: vi.fn(),
  getProfileByEmail: vi.fn(),
  markUserAndProfileEmailVerified: vi.fn(async () => {})
}));
vi.mock('@api/services/course/join-recipients', () => ({ getStudentJoinedRecipientEmails: vi.fn(async () => []) }));
vi.mock('@cio/email', () => ({
  buildEmailFromName: vi.fn(),
  buildEmailBranding: vi.fn(() => ({}))
}));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: vi.fn(async () => {}) }));
vi.mock('@cio/core/config/dashboard-url', () => ({ getDashboardBaseUrl: vi.fn(() => 'http://dash') }));
vi.mock('@api/services/course/compliance', () => ({
  ensureComplianceEnrollmentRecordsForProfiles: vi.fn(async () => {})
}));
vi.mock('@api/services/organization/student-limit', () => ({
  assertStudentCapacityOrThrow: vi.fn(async (_org: string, _n: number, client?: unknown) => {
    events.push(`capacity:${client === TX ? 'tx' : 'pool'}`);
  })
}));
vi.mock('@api/services/course/session-invite', () => ({ getWelcomeSessionIcs: vi.fn() }));
vi.mock('@cio/analytics', () => ({ trackServerEvent: vi.fn(), SERVER_EVENTS: { ENROLLMENT_COMPLETED: 'x' } }));

import {
  countInviteDistinctPreviewIps,
  selectCourseInviteAcceptBundleByTokenHash
} from '@cio/db/queries/course/invite';
import { getGroupMemberIdByGroupAndProfile } from '@cio/db/queries/group';
import { acceptStudentInvite } from '@api/services/course/invite';

const bundle = {
  invite: {
    id: 'inv1',
    courseId: 'c1',
    roleId: 3,
    usedCount: 0,
    maxUses: 5,
    isRevoked: false,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    allowedEmails: [],
    allowedDomains: []
  },
  course: { id: 'c1', groupId: 'g1', title: 'Course', status: 'ACTIVE', metadata: null },
  organization: {
    id: 'o1',
    name: 'Org',
    siteName: 'org',
    customDomain: null,
    isCustomDomainVerified: false,
    avatarUrl: null,
    theme: null
  }
};
const user = { id: 'u1', email: 'a@b.test' } as never;

beforeEach(() => {
  events.length = 0;
  vi.mocked(selectCourseInviteAcceptBundleByTokenHash).mockResolvedValue(bundle as never);
  vi.mocked(countInviteDistinctPreviewIps).mockResolvedValue(0);
  vi.mocked(getGroupMemberIdByGroupAndProfile).mockResolvedValue(null as never);
});

describe('acceptStudentInvite — no pool access inside the transaction', () => {
  it('a normal accept: IP read, capacity check and the ACCEPTED audit all use tx', async () => {
    await acceptStudentInvite('tok', user, { ipAddress: '1.1.1.1' });

    expect(vi.mocked(countInviteDistinctPreviewIps).mock.calls[0]?.[2]).toBe(TX);
    expect(events).toContain('capacity:tx');
    expect(events).toContain('audit:ACCEPTED:tx');
    expect(events.some((e) => e.endsWith(':pool'))).toBe(false);
  });

  it('the already-joined ACCEPTED audit also uses tx', async () => {
    vi.mocked(getGroupMemberIdByGroupAndProfile).mockResolvedValue(99 as never);
    await acceptStudentInvite('tok', user);
    expect(events).toContain('audit:ACCEPTED:tx');
    expect(events.some((e) => e.endsWith(':pool'))).toBe(false);
  });

  it('abuse block: throws 429, rolls the tx back, THEN writes ABUSE_BLOCKED on the pool (never inside the tx)', async () => {
    vi.mocked(countInviteDistinctPreviewIps).mockResolvedValue(50);

    await expect(acceptStudentInvite('tok', user, { ipAddress: '2.2.2.2' })).rejects.toMatchObject({
      statusCode: 429,
      message: 'Suspicious invite activity detected'
    });

    const rollback = events.indexOf('tx:rollback');
    const audit = events.indexOf('audit:ABUSE_BLOCKED:pool');
    expect(rollback).toBeGreaterThanOrEqual(0);
    expect(audit).toBeGreaterThan(rollback);
    expect(events).not.toContain('audit:ABUSE_BLOCKED:tx');
    // No false ACCEPTED row on a rejected accept.
    expect(events.some((e) => e.startsWith('audit:ACCEPTED'))).toBe(false);
  });
});
