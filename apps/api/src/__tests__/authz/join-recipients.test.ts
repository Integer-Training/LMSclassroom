import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// "Learner joined" emails carry the learner's name + email → recipients are the course ADMINs plus the tutors
// ALLOCATED to that learner, never the whole course team.

vi.mock('@cio/db/queries/allocation', () => ({ listTutorsForLearner: vi.fn() }));
vi.mock('@cio/db/queries/course/people', () => ({ getCourseAdminTeachers: vi.fn() }));

import { listTutorsForLearner } from '@cio/db/queries/allocation';
import { getCourseAdminTeachers } from '@cio/db/queries/course/people';
import { getStudentJoinedRecipientEmails } from '@api/services/course/join-recipients';

describe('getStudentJoinedRecipientEmails', () => {
  beforeEach(() => {
    vi.mocked(getCourseAdminTeachers).mockResolvedValue([{ email: 'admin@x.com' }] as never);
    vi.mocked(listTutorsForLearner).mockResolvedValue([{ email: 'tutor@x.com' }, { email: 'admin@x.com' }] as never);
  });

  it('admins + allocated tutors, de-duplicated', async () => {
    expect(await getStudentJoinedRecipientEmails('c-1', 'l-1')).toEqual(['admin@x.com', 'tutor@x.com']);
    expect(listTutorsForLearner).toHaveBeenCalledWith('l-1');
  });

  it('no learner profile yet (email-only add) → admins only', async () => {
    expect(await getStudentJoinedRecipientEmails('c-1', null)).toEqual(['admin@x.com']);
  });

  it('the enrolment services no longer mail the whole course team', () => {
    for (const f of ['services/course/invite.ts', 'services/course/people.ts']) {
      const s = readFileSync(resolve(__dirname, '../../', f), 'utf8');
      expect(s).not.toContain('getCourseTeachers');
      expect(s).toContain('getStudentJoinedRecipientEmails');
    }
  });

  it('createLearner allocates the tutor BEFORE enrolling (so the join email can reach them)', () => {
    const s = readFileSync(resolve(__dirname, '../../services/organization/management.ts'), 'utf8').replace(
      /\r\n/g,
      '\n'
    );
    const alloc = s.indexOf('await createTutorAllocation(orgId, actor, { tutorId: input.tutorId');
    const enrol = s.indexOf('await addCourseMember(input.courseId');
    expect(alloc).toBeGreaterThan(-1);
    expect(alloc).toBeLessThan(enrol);
  });
});
