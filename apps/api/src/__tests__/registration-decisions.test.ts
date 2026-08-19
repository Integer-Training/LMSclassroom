import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 7 Step 3 — approval-queue SERVICE. Proves: approve COMPOSES the Phase-5 onboardLearner (the
// ONLY create+enrol path) exactly once; the one-way claim refuses a re-decide (409); a duplicate account since
// submission is refused (409, no onboarding); an injected onboarding failure records NO audit (rolled back);
// reject records the note on the row but NEVER in audit metadata; Tutor/Learner/anon are denied. The tx +
// query layer are mocked (real DB race-safety is covered by the live harness).

vi.mock('@cio/db/drizzle', () => ({
  runInTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}))
}));
vi.mock('@cio/db/queries/registration', () => ({
  listRegistrations: vi.fn(),
  getRegistrationById: vi.fn(),
  claimPendingRegistration: vi.fn()
}));
vi.mock('@cio/db/queries/organization', () => ({ checkEmailExistsInOrg: vi.fn() }));
vi.mock('@api/services/onboarding/onboarding', () => ({ onboardLearner: vi.fn() }));
vi.mock('@cio/db/audit', () => ({
  recordAudit: vi.fn(),
  AUDIT_ACTIONS: { REGISTRATION_APPROVED: 'registration.approved', REGISTRATION_REJECTED: 'registration.rejected' }
}));

import { claimPendingRegistration } from '@cio/db/queries/registration';
import { checkEmailExistsInOrg } from '@cio/db/queries/organization';
import { onboardLearner } from '@api/services/onboarding/onboarding';
import { recordAudit } from '@cio/db/audit';
import { approveRegistration, rejectRegistration } from '@api/services/registration/decisions';

const mClaim = vi.mocked(claimPendingRegistration);
const mEmailExists = vi.mocked(checkEmailExistsInOrg);
const mOnboard = vi.mocked(onboardLearner);
const mAudit = vi.mocked(recordAudit);

const A = (role: string): Actor =>
  ({ authenticated: true, userId: 'mgr', role, status: 'ACTIVE', orgId: 'org1' }) as Actor;
const manager = A('MANAGER');
const claimedRow = {
  id: 'reg1',
  organizationId: 'org1',
  fullName: 'Ada',
  email: 'ada@x.test',
  requestedCourseId: 'c1',
  status: 'approved',
  createdAt: 't'
};

async function code(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { statusCode?: number })?.statusCode ?? -1;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mClaim.mockResolvedValue(claimedRow as never);
  mEmailExists.mockResolvedValue(false as never);
  mOnboard.mockResolvedValue({ userId: 'u1', courseId: 'c1', courseTitle: 'iCQ', learnerName: 'Ada' } as never);
});

describe('approveRegistration — composes Phase 5, one-way, race/duplicate safe', () => {
  it('happy path: claims once, onboards once with the requested course, audits approved', async () => {
    const res = await approveRegistration(manager, 'reg1', {});
    expect(mClaim).toHaveBeenCalledTimes(1);
    expect(mClaim.mock.calls[0][3]).toMatchObject({ status: 'approved', decidedBy: 'mgr' });
    expect(mOnboard).toHaveBeenCalledTimes(1);
    expect(mOnboard.mock.calls[0][1]).toMatchObject({ name: 'Ada', email: 'ada@x.test', courseId: 'c1' });
    expect(res).toMatchObject({ userId: 'u1', courseId: 'c1' });
    expect(mAudit.mock.calls[0][0]).toMatchObject({
      action: 'registration.approved',
      metadata: { registrationId: 'reg1', courseId: 'c1' }
    });
  });

  it('an adjusted course overrides the requested one', async () => {
    await approveRegistration(manager, 'reg1', { courseId: 'c2' });
    expect(mOnboard.mock.calls[0][1]).toMatchObject({ courseId: 'c2' });
  });

  it('re-decide refused (claim matched nothing) → 409, no onboarding, no audit', async () => {
    mClaim.mockResolvedValue(null as never);
    expect(await code(approveRegistration(manager, 'reg1', {}))).toBe(409);
    expect(mOnboard).not.toHaveBeenCalled();
    expect(mAudit).not.toHaveBeenCalled();
  });

  it('duplicate account since submission → 409, no onboarding', async () => {
    mEmailExists.mockResolvedValue(true as never);
    expect(await code(approveRegistration(manager, 'reg1', {}))).toBe(409);
    expect(mOnboard).not.toHaveBeenCalled();
    expect(mAudit).not.toHaveBeenCalled();
  });

  it('no course anywhere → 400, no onboarding', async () => {
    mClaim.mockResolvedValue({ ...claimedRow, requestedCourseId: null } as never);
    expect(await code(approveRegistration(manager, 'reg1', {}))).toBe(400);
    expect(mOnboard).not.toHaveBeenCalled();
  });

  it('injected onboarding failure → throws, NO audit (the claim rolls back with the tx)', async () => {
    mOnboard.mockRejectedValue(new Error('boom') as never);
    await expect(approveRegistration(manager, 'reg1', {})).rejects.toThrow();
    expect(mAudit).not.toHaveBeenCalled();
  });

  it('Tutor/Learner denied 403, anon 401 — no claim attempted', async () => {
    expect(await code(approveRegistration(A('TUTOR'), 'reg1', {}))).toBe(403);
    expect(await code(approveRegistration(A('LEARNER'), 'reg1', {}))).toBe(403);
    expect(await code(approveRegistration({ authenticated: false } as Actor, 'reg1', {}))).toBe(401);
    expect(mClaim).not.toHaveBeenCalled();
  });
});

describe('rejectRegistration — note on the row, never in audit; one-way', () => {
  it('records rejected + note, audits with NO note in metadata', async () => {
    mClaim.mockResolvedValue({ ...claimedRow, status: 'rejected' } as never);
    const res = await rejectRegistration(manager, 'reg1', { note: 'Incomplete application' });
    expect(mClaim.mock.calls[0][3]).toMatchObject({ status: 'rejected', decisionNote: 'Incomplete application' });
    expect(res).toMatchObject({ status: 'rejected' });
    const auditArg = mAudit.mock.calls[0][0] as { action: string; metadata: Record<string, unknown> };
    expect(auditArg.action).toBe('registration.rejected');
    expect(auditArg.metadata).toEqual({ registrationId: 'reg1' });
    expect(JSON.stringify(auditArg.metadata)).not.toContain('Incomplete');
  });

  it('empty note → 400, no write', async () => {
    expect(await code(rejectRegistration(manager, 'reg1', { note: '   ' }))).toBe(400);
    expect(mClaim).not.toHaveBeenCalled();
  });

  it('re-decide refused → 409', async () => {
    mClaim.mockResolvedValue(null as never);
    expect(await code(rejectRegistration(manager, 'reg1', { note: 'x' }))).toBe(409);
  });

  it('Tutor denied 403', async () => {
    expect(await code(rejectRegistration(A('TUTOR'), 'reg1', { note: 'x' }))).toBe(403);
  });
});
