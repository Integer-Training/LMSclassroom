import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 7 Step 4 — ID-verification SERVICE. Proves: recording is Manager/Admin OR the learner's
// allocated Tutor (non-allocated tutor + learner denied); status/method must be from config; the audit carries
// learner id + status + method label and NEVER the note text; a learner sees their OWN status only and cannot
// fetch a staff record. Allocation predicate + queries + audit are mocked.

vi.mock('@api/middlewares/guards/ownership', () => ({ isAllocatedTutor: vi.fn() }));
vi.mock('@cio/db/queries/id-verification', () => ({
  getIdVerificationForLearner: vi.fn(),
  upsertIdVerification: vi.fn()
}));
vi.mock('@cio/db/audit', () => ({
  recordAudit: vi.fn(),
  AUDIT_ACTIONS: { ID_VERIFICATION_RECORDED: 'id_verification.recorded' }
}));

import { isAllocatedTutor } from '@api/middlewares/guards/ownership';
import { getIdVerificationForLearner, upsertIdVerification } from '@cio/db/queries/id-verification';
import { recordAudit } from '@cio/db/audit';
import {
  recordIdVerification,
  getLearnerIdVerification,
  getMyIdVerification
} from '@api/services/registration/id-verification';

const mAlloc = vi.mocked(isAllocatedTutor);
const mGet = vi.mocked(getIdVerificationForLearner);
const mUpsert = vi.mocked(upsertIdVerification);
const mAudit = vi.mocked(recordAudit);

const A = (id: string, role: string): Actor =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;
const LEARNER = 'learner-1';

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
  mAlloc.mockResolvedValue(false as never);
  mGet.mockResolvedValue(null as never);
  mUpsert.mockResolvedValue({
    id: 'idv1',
    learnerId: LEARNER,
    status: 'verified',
    method: 'passport',
    verifiedBy: 'mgr',
    verifiedAt: '2026-08-19T00:00:00Z',
    note: 'saw passport',
    updatedAt: '2026-08-19T00:00:00Z'
  } as never);
});

describe('recordIdVerification — roles + allocation', () => {
  it('Admin and Manager can record (no allocation needed)', async () => {
    await recordIdVerification(A('admin', 'ADMIN'), LEARNER, { status: 'verified', method: 'passport' });
    await recordIdVerification(A('mgr', 'MANAGER'), LEARNER, { status: 'verified', method: 'passport' });
    expect(mUpsert).toHaveBeenCalledTimes(2);
  });

  it('an ALLOCATED tutor can record; a non-allocated tutor is denied 403', async () => {
    mAlloc.mockResolvedValue(true as never);
    await recordIdVerification(A('t1', 'TUTOR'), LEARNER, { status: 'verified', method: 'driving_licence' });
    expect(mUpsert).toHaveBeenCalledTimes(1);
    expect(mAlloc).toHaveBeenCalledWith(expect.anything(), LEARNER);

    mAlloc.mockResolvedValue(false as never);
    expect(await code(recordIdVerification(A('t2', 'TUTOR'), LEARNER, { status: 'verified' }))).toBe(403);
  });

  it('a Learner cannot record (403); anon 401', async () => {
    expect(await code(recordIdVerification(A('l', 'LEARNER'), LEARNER, { status: 'verified' }))).toBe(403);
    expect(await code(recordIdVerification({ authenticated: false } as Actor, LEARNER, { status: 'verified' }))).toBe(
      401
    );
    expect(mUpsert).not.toHaveBeenCalled();
  });

  it('status + method must be from config', async () => {
    expect(await code(recordIdVerification(A('admin', 'ADMIN'), LEARNER, { status: 'bogus' }))).toBe(400);
    expect(
      await code(recordIdVerification(A('admin', 'ADMIN'), LEARNER, { status: 'verified', method: 'retina-scan' }))
    ).toBe(400);
    expect(mUpsert).not.toHaveBeenCalled();
  });

  it('audit carries learner id + status + method — NEVER the note text', async () => {
    await recordIdVerification(A('admin', 'ADMIN'), LEARNER, {
      status: 'verified',
      method: 'passport',
      note: 'saw passport in person'
    });
    const arg = mAudit.mock.calls[0][0] as { action: string; metadata: Record<string, unknown> };
    expect(arg.action).toBe('id_verification.recorded');
    expect(arg.metadata).toEqual({ learnerId: LEARNER, status: 'verified', method: 'passport' });
    expect(JSON.stringify(arg.metadata)).not.toContain('saw passport');
  });
});

describe('reads — staff full record vs learner self', () => {
  it('a Learner cannot fetch a staff record for anyone (403)', async () => {
    expect(await code(getLearnerIdVerification(A('l', 'LEARNER'), LEARNER))).toBe(403);
  });

  it('getMyIdVerification returns the ACTOR own status; verifiedAt only when verified', async () => {
    mGet.mockResolvedValue({
      id: 'x',
      learnerId: 'me',
      status: 'verified',
      method: 'passport',
      verifiedBy: 's',
      verifiedAt: '2026-08-19T00:00:00Z',
      note: 'n',
      updatedAt: 'u'
    } as never);
    const mine = await getMyIdVerification(A('me', 'LEARNER'));
    expect(mGet).toHaveBeenCalledWith('me');
    expect(mine).toEqual({ status: 'verified', verifiedAt: '2026-08-19T00:00:00Z' });

    mGet.mockResolvedValue({
      id: 'x',
      learnerId: 'me',
      status: 'not_verified',
      method: null,
      verifiedBy: null,
      verifiedAt: null,
      note: null,
      updatedAt: 'u'
    } as never);
    expect(await getMyIdVerification(A('me', 'LEARNER'))).toEqual({ status: 'not_verified', verifiedAt: null });
  });

  it('default (no row) → not_verified for the learner', async () => {
    mGet.mockResolvedValue(null as never);
    expect(await getMyIdVerification(A('me', 'LEARNER'))).toEqual({ status: 'not_verified', verifiedAt: null });
  });
});
