import { beforeEach, describe, expect, it, vi } from 'vitest';

// PearlLMS Phase 7 — public registration intake SERVICE. Proves: a submission writes exactly ONE pending row
// and NEVER an account (the service imports nothing from the auth stack); honeypot silently drops; duplicate
// existing-member OR open-pending email is refused (neutral 409); an invalid course 400s; staff are notified
// through the Phase-6 framework; a notification failure never fails the submission. Queries + notify mocked.

vi.mock('@cio/db/queries/organization', () => ({
  getFirstOrganization: vi.fn(),
  checkEmailExistsInOrg: vi.fn(),
  getOrgManagersAndAdmins: vi.fn()
}));
vi.mock('@cio/db/queries/onboarding', () => ({
  getCourseEnrolmentTarget: vi.fn(),
  listPublishedCoursesForOrg: vi.fn()
}));
vi.mock('@cio/db/queries/registration', () => ({
  insertRegistration: vi.fn(),
  hasOpenRegistrationForEmail: vi.fn()
}));
vi.mock('@api/services/comms/notify', () => ({ emitNotification: vi.fn() }));

import { getFirstOrganization, checkEmailExistsInOrg, getOrgManagersAndAdmins } from '@cio/db/queries/organization';
import { getCourseEnrolmentTarget } from '@cio/db/queries/onboarding';
import { insertRegistration, hasOpenRegistrationForEmail } from '@cio/db/queries/registration';
import { emitNotification } from '@api/services/comms/notify';
import { submitRegistration } from '@api/services/registration/registration';
import { resetRegistrationRateLimit } from '@api/services/registration/rate-limit';

const mOrg = vi.mocked(getFirstOrganization);
const mEmailExists = vi.mocked(checkEmailExistsInOrg);
const mManagers = vi.mocked(getOrgManagersAndAdmins);
const mCourse = vi.mocked(getCourseEnrolmentTarget);
const mInsert = vi.mocked(insertRegistration);
const mHasPending = vi.mocked(hasOpenRegistrationForEmail);
const mEmit = vi.mocked(emitNotification);

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
  resetRegistrationRateLimit();
  mOrg.mockResolvedValue({ id: 'org1' } as never);
  mEmailExists.mockResolvedValue(false as never);
  mHasPending.mockResolvedValue(false as never);
  mCourse.mockResolvedValue({ courseId: 'c1', title: 'iCQ', orgId: 'org1', isPublished: true, groupId: 'g1' } as never);
  mInsert.mockResolvedValue({
    id: 'reg1',
    organizationId: 'org1',
    fullName: 'Ada',
    email: 'ada@x.test',
    requestedCourseId: null,
    status: 'pending',
    createdAt: 't'
  } as never);
  mManagers.mockResolvedValue([{ userId: 'm1', email: 'mgr@x.test' }] as never);
  mEmit.mockResolvedValue(undefined as never);
});

describe('submitRegistration — writes a pending row, never an account', () => {
  it('happy path: one pending row (lowercased email), no user, staff notified', async () => {
    const res = await submitRegistration({ fullName: '  Ada  ', email: 'Ada@X.test', clientIp: '1.1.1.1' });
    expect(res).toEqual({ ok: true });
    expect(mInsert).toHaveBeenCalledTimes(1);
    expect(mInsert.mock.calls[0][0]).toMatchObject({ organizationId: 'org1', fullName: 'Ada', email: 'ada@x.test' });
    // notified via the framework with the registration type + manager recipient
    expect(mEmit).toHaveBeenCalledTimes(1);
    expect(mEmit.mock.calls[0][0]).toMatchObject({
      type: 'registration.submitted',
      emailTemplateId: 'registrationSubmitted'
    });
    expect((mEmit.mock.calls[0][0] as { recipients: { userId: string }[] }).recipients[0].userId).toBe('m1');
  });

  it('honeypot filled → silent drop: no row, no notification, looks successful', async () => {
    const res = await submitRegistration({
      fullName: 'Bot',
      email: 'bot@x.test',
      honeypot: 'http://spam',
      clientIp: '2.2.2.2'
    });
    expect(res).toEqual({ ok: true, dropped: true });
    expect(mInsert).not.toHaveBeenCalled();
    expect(mEmit).not.toHaveBeenCalled();
  });

  it('duplicate existing member → 409, no write', async () => {
    mEmailExists.mockResolvedValue(true as never);
    expect(await code(submitRegistration({ fullName: 'Ada', email: 'ada@x.test', clientIp: '3.3.3.3' }))).toBe(409);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('duplicate open pending registration → 409, no write', async () => {
    mHasPending.mockResolvedValue(true as never);
    expect(await code(submitRegistration({ fullName: 'Ada', email: 'ada@x.test', clientIp: '4.4.4.4' }))).toBe(409);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('a requested course not published/in-org → 400, no write', async () => {
    mCourse.mockResolvedValue({
      courseId: 'c1',
      title: 'x',
      orgId: 'other',
      isPublished: true,
      groupId: 'g1'
    } as never);
    expect(
      await code(
        submitRegistration({
          fullName: 'Ada',
          email: 'ada@x.test',
          requestedCourseId: '11111111-1111-4111-8111-111111111111',
          clientIp: '5.5.5.5'
        })
      )
    ).toBe(400);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('invalid email → 400', async () => {
    expect(await code(submitRegistration({ fullName: 'Ada', email: 'not-an-email', clientIp: '6.6.6.6' }))).toBe(400);
    expect(mInsert).not.toHaveBeenCalled();
  });

  it('a notification failure does NOT fail the submission (best-effort)', async () => {
    mEmit.mockRejectedValue(new Error('redis down') as never);
    const res = await submitRegistration({ fullName: 'Ada', email: 'ada@x.test', clientIp: '7.7.7.7' });
    expect(res).toEqual({ ok: true });
    expect(mInsert).toHaveBeenCalledTimes(1);
  });
});
