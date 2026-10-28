import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Phase E / decision 12 — the org-wide progression builder (which the learners report is made from) is open to a
// MANAGER (read-only, as managers already read org-wide data) as well as an ADMIN. Tutors and learners stay out.

vi.mock('@cio/db/queries/allocation', () => ({
  listAllocatedLearnersForOrg: vi.fn(async () => []),
  listLearnersForTutor: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/dash', () => ({
  listOrgLearners: vi.fn(async () => [{ learnerId: 'l1', name: 'L One', email: 'l1@t.test' }])
}));
vi.mock('@cio/db/queries/caseload', () => ({
  getCoursesForLearners: vi.fn(async () => []),
  getEnrolmentsForLearners: vi.fn(async () => []),
  getProfileStatusForIds: vi.fn(async () => new Map()),
  getUnitTimeForLearners: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/progress', () => ({ computeLearnerCourseProgress: vi.fn() }));
vi.mock('@cio/db/queries/gating', () => ({ getOrderedUnitsForCourse: vi.fn(async () => []) }));
vi.mock('@cio/db/queries/coursework', () => ({
  getAssessmentItemsByLesson: vi.fn(async () => new Map()),
  getSubmissionsWithContextForLearners: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/reports', () => ({
  getCourseProgressReport: vi.fn(async () => []),
  getLatestMarkedResultsForCourse: vi.fn(async () => [])
}));
vi.mock('@cio/db/queries/analytics', () => ({ getLastSeenForUserIds: vi.fn(async () => new Map()) }));
vi.mock('@api/middlewares/guards', () => ({ isAllocatedTutor: vi.fn(async () => false) }));

import { listOrgLearners } from '@cio/db/queries/dash';
import { getOrgProgression } from '@api/services/progression/progression';

const A = (role: string): Actor => ({ authenticated: true, userId: 'u', role, status: 'ACTIVE', orgId: 'o1' }) as Actor;

beforeEach(() => vi.clearAllMocks());

describe('getOrgProgression access', () => {
  it('ADMIN and MANAGER may build the org-wide list', async () => {
    await expect(getOrgProgression(A('ADMIN'))).resolves.toBeDefined();
    await expect(getOrgProgression(A('MANAGER'))).resolves.toBeDefined();
    expect(listOrgLearners).toHaveBeenCalledWith('o1');
  });

  it('TUTOR, LEARNER and anonymous are refused before any query', async () => {
    await expect(getOrgProgression(A('TUTOR'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getOrgProgression(A('LEARNER'))).rejects.toMatchObject({ statusCode: 403 });
    await expect(getOrgProgression({ authenticated: false } as Actor)).rejects.toMatchObject({ statusCode: 401 });
    expect(listOrgLearners).not.toHaveBeenCalled();
  });
});
