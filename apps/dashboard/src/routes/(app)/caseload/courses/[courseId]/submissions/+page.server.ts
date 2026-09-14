import { requireStaff } from '$lib/server/guards';

// Tutor submissions grid for one assessment on a unit (Moodle-style marking table). ADMIN or TUTOR
// only. The caseload submissions API re-enforces the allocated-only scope; lessonId + assessmentKey
// are read client-side from the query string.
export const load = async ({ locals, params }) => {
  requireStaff(locals);
  return { courseId: params.courseId };
};
