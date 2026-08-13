import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isCourseGroupMember } from '@cio/db/queries/group';
import { getCourseById } from '@cio/db/queries/course';
import { isEnrolledLearner, canReadCourseContent } from '@api/middlewares/guards';
import { ZUnitType, ZUnitTypeNullable, UNIT_TYPES } from '@cio/utils/validation/course';
import type { Actor } from '@cio/utils/auth';

// The DB-backed content-access predicates (Phase 2). isCourseGroupMember (enrolment) and
// getCourseById (publish state) are the only DB touches; mock them so the decision logic is a
// pure unit test — no database, no server.
vi.mock('@cio/db/queries/group', () => ({ isCourseGroupMember: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn() }));

const mockedIsMember = vi.mocked(isCourseGroupMember);
const mockedGetCourse = vi.mocked(getCourseById);

const learner: Actor = { authenticated: true, userId: 'u-learner', role: 'LEARNER', status: 'ACTIVE', orgId: 'org-1' };
const tutor: Actor = { authenticated: true, userId: 'u-tutor', role: 'TUTOR', status: 'ACTIVE', orgId: 'org-1' };
const manager: Actor = { authenticated: true, userId: 'u-manager', role: 'MANAGER', status: 'ACTIVE', orgId: 'org-1' };
const admin: Actor = { authenticated: true, userId: 'u-admin', role: 'ADMIN', status: 'ACTIVE', orgId: 'org-1' };
const anon: Actor = { authenticated: false, reason: 'anonymous' };
const deactivated: Actor = { authenticated: false, reason: 'deactivated', userId: 'u-x' };

// getCourseById returns `Course[]` (limit 1); we only assert on isPublished + status.
const publishedRow = [{ isPublished: true, status: 'ACTIVE' }] as never;
const draftRow = [{ isPublished: false, status: 'ACTIVE' }] as never;
const archivedRow = [{ isPublished: true, status: 'ARCHIVED' }] as never;
const noCourse = [] as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isEnrolledLearner — enrolment only (no role/publish inference)', () => {
  it('true when the actor is a member of the course group', async () => {
    mockedIsMember.mockResolvedValue(true);
    await expect(isEnrolledLearner(learner, 'course-1')).resolves.toBe(true);
    expect(mockedIsMember).toHaveBeenCalledWith('course-1', 'u-learner');
  });

  it('false when the actor is not a member', async () => {
    mockedIsMember.mockResolvedValue(false);
    await expect(isEnrolledLearner(learner, 'course-1')).resolves.toBe(false);
  });

  it('reflects membership for staff too — bypass lives in canReadCourseContent, not here', async () => {
    mockedIsMember.mockResolvedValue(false);
    await expect(isEnrolledLearner(admin, 'course-1')).resolves.toBe(false);
  });

  it('false for anonymous / deactivated without any DB call', async () => {
    await expect(isEnrolledLearner(anon, 'course-1')).resolves.toBe(false);
    await expect(isEnrolledLearner(deactivated, 'course-1')).resolves.toBe(false);
    expect(mockedIsMember).not.toHaveBeenCalled();
  });
});

describe('canReadCourseContent — staff bypass OR enrolled-learner-of-a-published-course', () => {
  it('any staff role reads regardless of enrolment or publish state (incl. drafts)', async () => {
    mockedIsMember.mockResolvedValue(false);
    mockedGetCourse.mockResolvedValue(draftRow);
    for (const staff of [admin, tutor, manager]) {
      await expect(canReadCourseContent(staff, 'course-1')).resolves.toBe(true);
    }
    // Staff bypass short-circuits before any enrolment / publish lookup.
    expect(mockedIsMember).not.toHaveBeenCalled();
    expect(mockedGetCourse).not.toHaveBeenCalled();
  });

  it('enrolled learner + published course → true', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(publishedRow);
    await expect(canReadCourseContent(learner, 'course-1')).resolves.toBe(true);
  });

  it('enrolled learner + DRAFT course → false (no draft leakage to learners)', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(draftRow);
    await expect(canReadCourseContent(learner, 'course-1')).resolves.toBe(false);
  });

  it('enrolled learner + published-flag but non-ACTIVE status → false (both must agree)', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(archivedRow);
    await expect(canReadCourseContent(learner, 'course-1')).resolves.toBe(false);
  });

  it('NON-enrolled learner + published course → false (enrolment required)', async () => {
    mockedIsMember.mockResolvedValue(false);
    mockedGetCourse.mockResolvedValue(publishedRow);
    await expect(canReadCourseContent(learner, 'course-1')).resolves.toBe(false);
  });

  it('missing course row → false', async () => {
    mockedIsMember.mockResolvedValue(true);
    mockedGetCourse.mockResolvedValue(noCourse);
    await expect(canReadCourseContent(learner, 'course-1')).resolves.toBe(false);
  });

  it('anonymous / deactivated → false, no DB call', async () => {
    await expect(canReadCourseContent(anon, 'course-1')).resolves.toBe(false);
    await expect(canReadCourseContent(deactivated, 'course-1')).resolves.toBe(false);
    expect(mockedIsMember).not.toHaveBeenCalled();
    expect(mockedGetCourse).not.toHaveBeenCalled();
  });
});

describe('ZUnitType — only the configured labels validate', () => {
  it('accepts every configured label', () => {
    for (const label of UNIT_TYPES) {
      expect(ZUnitType.safeParse(label).success).toBe(true);
    }
  });

  it('rejects off-list values, empty string, and wrong case', () => {
    for (const bad of ['quiz', 'exam', '', 'Session', 'ID-CHECK', 'sessions']) {
      expect(ZUnitType.safeParse(bad).success).toBe(false);
    }
  });

  it('ZUnitTypeNullable accepts null/undefined (a session with no type) and configured labels', () => {
    expect(ZUnitTypeNullable.safeParse(null).success).toBe(true);
    expect(ZUnitTypeNullable.safeParse(undefined).success).toBe(true);
    expect(ZUnitTypeNullable.safeParse('session').success).toBe(true);
    expect(ZUnitTypeNullable.safeParse('quiz').success).toBe(false);
  });
});
