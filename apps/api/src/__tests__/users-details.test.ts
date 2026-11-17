import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Actor } from '@cio/db/actor';

// Admin edit of a tutor/learner NAME (PUT /organization/users/:memberId/details). Two proofs:
//  (A) route: Admin only (Manager/Tutor/Learner 403, anon 401), name validated (trim, collapse spaces, 1-200).
//  (B) service: both name columns written in ONE transaction, TUTOR/STUDENT targets only, cross-org → 404,
//      no-op when unchanged, audit = field NAME only.

vi.mock('@cio/db/auth', () => ({ auth: { api: {} } }));
vi.mock('@cio/db/queries/organization', () => ({
  countActiveOrgAdmins: vi.fn(),
  createOrganizationMember: vi.fn(),
  deleteSessionsByUserId: vi.fn(),
  getOrganizationMemberByIdAndOrg: vi.fn(),
  getOrganizationUsers: vi.fn(),
  getSuperAdminMemberId: vi.fn(),
  getUserOrgRolesMap: vi.fn(),
  setCredentialPassword: vi.fn()
}));
vi.mock('@cio/db/queries/learner-profile', () => ({
  getLearnerProfileByUserId: vi.fn(),
  upsertLearnerProfile: vi.fn()
}));
vi.mock('@cio/db/queries/organization/invite', () => ({ updateOrganizationMemberById: vi.fn() }));
vi.mock('@cio/db/queries/auth', () => ({
  getProfileById: vi.fn(),
  markUserAndProfileEmailVerified: vi.fn(),
  updateProfile: vi.fn(),
  updateUserAndProfileName: vi.fn(async () => undefined)
}));
vi.mock('@cio/db/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/audit')>()),
  recordAudit: vi.fn(async () => undefined)
}));
vi.mock('@cio/db/drizzle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cio/db/drizzle')>()),
  runInTransaction: (fn: (tx: unknown) => unknown) => fn({ tx: true })
}));
vi.mock('@api/services/onboarding/onboarding', () => ({ listOnboardingCourses: vi.fn(), onboardLearner: vi.fn() }));

import { getOrganizationMemberByIdAndOrg, getUserOrgRolesMap } from '@cio/db/queries/organization';
import { getProfileById, updateUserAndProfileName } from '@cio/db/queries/auth';
import { recordAudit } from '@cio/db/audit';
import { updateMemberName } from '@api/services/organization/users';
import { usersRouter } from '@api/routes/organization/users';

const ORG = 'org-1';
const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: ORG }) as Actor;
const admin = A('u-admin', 'ADMIN');
const ACTORS: Record<string, Actor | undefined> = {
  admin,
  manager: A('u-mgr', 'MANAGER'),
  tutor: A('u-tutor', 'TUTOR'),
  learner: A('u-learner', 'LEARNER'),
  anon: undefined
};

const mMember = vi.mocked(getOrganizationMemberByIdAndOrg);
const mRoles = vi.mocked(getUserOrgRolesMap);
const mProfile = vi.mocked(getProfileById);
const mUpdate = vi.mocked(updateUserAndProfileName);
const mAudit = vi.mocked(recordAudit);

beforeEach(() => {
  vi.clearAllMocks();
  mMember.mockResolvedValue({ id: 7, profileId: 'u-target' });
  mRoles.mockResolvedValue({ [ORG]: 3 });
  mProfile.mockResolvedValue({ id: 'u-target', fullname: 'Old Name' } as never);
});

describe('PUT /users/:memberId/details — route', () => {
  const app = new Hono()
    .use('*', async (c, next) => {
      const actor = ACTORS[c.req.header('x-actor') ?? 'anon'];
      if (actor) c.set('actor', actor);
      await next();
    })
    .route('/users', usersRouter);
  const put = (actor: string, body: unknown) =>
    app.request('/users/7/details', {
      method: 'PUT',
      headers: { 'x-actor': actor, 'content-type': 'application/json', 'cio-org-id': ORG },
      body: JSON.stringify(body)
    });

  it('Admin 200; Manager/Tutor/Learner 403; anon 401', async () => {
    expect((await put('admin', { name: 'New Name' })).status).toBe(200);
    expect((await put('manager', { name: 'New Name' })).status).toBe(403);
    expect((await put('tutor', { name: 'New Name' })).status).toBe(403);
    expect((await put('learner', { name: 'New Name' })).status).toBe(403);
    expect((await put('anon', { name: 'New Name' })).status).toBe(401);
  });

  it('rejects empty / whitespace-only / over-long names (400); trims and collapses spaces', async () => {
    expect((await put('admin', { name: '' })).status).toBe(400);
    expect((await put('admin', { name: '   ' })).status).toBe(400);
    expect((await put('admin', { name: 'x'.repeat(201) })).status).toBe(400);
    expect((await put('admin', {})).status).toBe(400);
    expect((await put('admin', { name: '  Ann   Marie  Lee ' })).status).toBe(200);
    expect(mUpdate).toHaveBeenLastCalledWith('u-target', 'Ann Marie Lee', expect.anything());
  });
});

describe('updateMemberName — service', () => {
  it('writes user.name + profile.fullname in one tx call and audits the field NAME only', async () => {
    const res = await updateMemberName(ORG, admin, 7, 'New Name');
    expect(res).toEqual({ userId: 'u-target', changed: true });
    expect(mUpdate).toHaveBeenCalledTimes(1);
    expect(mUpdate).toHaveBeenCalledWith('u-target', 'New Name', { tx: true });
    expect(mAudit).toHaveBeenCalledTimes(1);
    const audit = mAudit.mock.calls[0][0];
    expect(audit.action).toBe('profile.updated');
    expect(audit.entityId).toBe('u-target');
    expect(audit.metadata).toEqual({ fields: ['fullname'] });
    expect(JSON.stringify(audit.metadata)).not.toContain('New Name');
  });

  it('allows TUTOR targets', async () => {
    mRoles.mockResolvedValue({ [ORG]: 2 });
    await expect(updateMemberName(ORG, admin, 7, 'New Name')).resolves.toMatchObject({ changed: true });
  });

  it('refuses ADMIN / MANAGER targets (403) — admins use self-service', async () => {
    for (const roleId of [1, 4]) {
      mRoles.mockResolvedValue({ [ORG]: roleId });
      await expect(updateMemberName(ORG, admin, 7, 'New Name')).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(mUpdate).not.toHaveBeenCalled();
  });

  it('member of another org / unknown → 404', async () => {
    mMember.mockResolvedValue(null);
    await expect(updateMemberName(ORG, admin, 7, 'New Name')).rejects.toMatchObject({ statusCode: 404 });
    expect(mUpdate).not.toHaveBeenCalled();
  });

  it('unchanged name is a no-op (no write, no audit)', async () => {
    const res = await updateMemberName(ORG, admin, 7, 'Old Name');
    expect(res).toEqual({ userId: 'u-target', changed: false });
    expect(mUpdate).not.toHaveBeenCalled();
    expect(mAudit).not.toHaveBeenCalled();
  });
});
