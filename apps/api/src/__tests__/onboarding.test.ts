import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// PearlLMS Phase 5 Step 5 — lite onboarding service (TEST-FIRST). Proves: atomic create+enrol composes the
// existing machinery; a duplicate email or an invalid course leaves NOTHING partially created (enrolment is
// never reached); the flow validates the course before provisioning. Better Auth + DB are mocked.

vi.mock('@api/services/organization/users', () => ({ createOrgUser: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ addCourseMember: vi.fn() }));
vi.mock('@api/services/course/compliance', () => ({ ensureComplianceEnrollmentRecordsForProfiles: vi.fn() }));
vi.mock('@cio/db/queries/onboarding', () => ({
  getCourseEnrolmentTarget: vi.fn(),
  listPublishedCoursesForOrg: vi.fn()
}));

import { createOrgUser } from '@api/services/organization/users';
import { addCourseMember } from '@cio/db/queries/course';
import { ensureComplianceEnrollmentRecordsForProfiles } from '@api/services/course/compliance';
import { getCourseEnrolmentTarget } from '@cio/db/queries/onboarding';
import { onboardLearner } from '@api/services/onboarding/onboarding';

const mCreate = vi.mocked(createOrgUser);
const mEnrol = vi.mocked(addCourseMember);
const mCompliance = vi.mocked(ensureComplianceEnrollmentRecordsForProfiles);
const mTarget = vi.mocked(getCourseEnrolmentTarget);

const ORG = 'org-1';
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: ORG };
const COURSE = '11111111-1111-4111-8111-111111111111';
const INPUT = { name: 'New Learner', email: 'New.Learner@Example.com', courseId: COURSE };

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
  mTarget.mockResolvedValue({ courseId: COURSE, title: 'iCQ', orgId: ORG, isPublished: true, groupId: 'g1' });
  mCreate.mockResolvedValue({ userId: 'new-user-1', roleId: 3 });
  mEnrol.mockResolvedValue({} as never);
  mCompliance.mockResolvedValue(undefined as never);
});

describe('onboardLearner — atomic create + enrol', () => {
  it('creates the account (Learner) then enrols into the course, returning what was created', async () => {
    const result = await onboardLearner(admin, INPUT);
    expect(mCreate).toHaveBeenCalledWith(ORG, admin, {
      name: 'New Learner',
      email: 'new.learner@example.com',
      roleId: 3
    });
    expect(mEnrol).toHaveBeenCalledWith(COURSE, {
      profileId: 'new-user-1',
      roleId: 3,
      email: 'new.learner@example.com'
    });
    expect(result).toEqual({ userId: 'new-user-1', courseId: COURSE, courseTitle: 'iCQ', learnerName: 'New Learner' });
  });

  it('provisions BEFORE enrolling (create is called before enrol)', async () => {
    const order: string[] = [];
    mCreate.mockImplementation(async () => {
      order.push('create');
      return { userId: 'new-user-1', roleId: 3 };
    });
    mEnrol.mockImplementation(async () => {
      order.push('enrol');
      return {} as never;
    });
    await onboardLearner(admin, INPUT);
    expect(order).toEqual(['create', 'enrol']);
  });
});

describe('onboardLearner — failure paths leave no partial state', () => {
  it('duplicate email (createOrgUser 409) → enrolment is NEVER attempted', async () => {
    mCreate.mockRejectedValue(Object.assign(new Error('exists'), { statusCode: 409 }));
    expect(await code(onboardLearner(admin, INPUT))).toBe(409);
    expect(mEnrol).not.toHaveBeenCalled();
  });

  it('unpublished course → 400 BEFORE any account is created', async () => {
    mTarget.mockResolvedValue({ courseId: COURSE, title: 'Draft', orgId: ORG, isPublished: false, groupId: 'g1' });
    expect(await code(onboardLearner(admin, INPUT))).toBe(400);
    expect(mCreate).not.toHaveBeenCalled();
    expect(mEnrol).not.toHaveBeenCalled();
  });

  it('a course in another org → 403 before any account is created', async () => {
    mTarget.mockResolvedValue({
      courseId: COURSE,
      title: 'Other',
      orgId: 'other-org',
      isPublished: true,
      groupId: 'g1'
    });
    expect(await code(onboardLearner(admin, INPUT))).toBe(403);
    expect(mCreate).not.toHaveBeenCalled();
  });

  it('unknown course → 404 before any account is created', async () => {
    mTarget.mockResolvedValue(null);
    expect(await code(onboardLearner(admin, INPUT))).toBe(404);
    expect(mCreate).not.toHaveBeenCalled();
  });
});
