import { listTutorsForLearner } from '@cio/db/queries/allocation';
import { getCourseAdminTeachers } from '@cio/db/queries/course/people';

/**
 * Who is told that a learner joined a course (learner name + email travel in the mail): the course's ADMINs
 * plus the tutors ALLOCATED to that learner. A course-team tutor without an allocation is not told
 * (learner-visibility rule). Allocation must already be written when this runs.
 */
export async function getStudentJoinedRecipientEmails(courseId: string, studentProfileId?: string | null) {
  const [admins, tutors] = await Promise.all([
    getCourseAdminTeachers(courseId),
    studentProfileId ? listTutorsForLearner(studentProfileId) : Promise.resolve([])
  ]);

  return [...new Set([...admins, ...tutors].map((person) => person.email).filter((email): email is string => !!email))];
}
