import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '@cio/db/actor';

// Learner-visibility rule for GET /course/:id/compliance/learners/:profileId — self, ADMIN, or the TUTOR
// allocated to that learner; a course-team tutor without an allocation is refused.

vi.mock('@cio/db/queries/allocation', () => ({ isTutorAllocatedToLearner: vi.fn() }));

import { isTutorAllocatedToLearner } from '@cio/db/queries/allocation';
import { assertCourseComplianceHistoryAccess } from '@api/services/course/compliance';

const A = (id: string, role: string) =>
  ({ authenticated: true, userId: id, role, status: 'ACTIVE', orgId: 'o1' }) as Actor;

describe('assertCourseComplianceHistoryAccess', () => {
  it('a learner may read their OWN history', async () => {
    await expect(assertCourseComplianceHistoryAccess('l1', 'l1', A('l1', 'LEARNER'))).resolves.toBeUndefined();
  });

  it('a learner may NOT read a classmate', async () => {
    await expect(assertCourseComplianceHistoryAccess('l1', 'l2', A('l1', 'LEARNER'))).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('ADMIN may read any learner', async () => {
    await expect(assertCourseComplianceHistoryAccess('a1', 'l2', A('a1', 'ADMIN'))).resolves.toBeUndefined();
  });

  it('an ALLOCATED tutor may; an unallocated (course-team) tutor may not', async () => {
    vi.mocked(isTutorAllocatedToLearner).mockResolvedValueOnce(true as never);
    await expect(assertCourseComplianceHistoryAccess('t1', 'l2', A('t1', 'TUTOR'))).resolves.toBeUndefined();

    vi.mocked(isTutorAllocatedToLearner).mockResolvedValueOnce(false as never);
    await expect(assertCourseComplianceHistoryAccess('t1', 'l2', A('t1', 'TUTOR'))).rejects.toMatchObject({
      statusCode: 403
    });
  });
});
