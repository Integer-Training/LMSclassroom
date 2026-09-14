import { requireStaff } from '$lib/server/guards';

// Tutor read-only unit view (PearlLMS — unit-by-unit). ADMIN or TUTOR only. The caseload content/unit
// APIs re-enforce the allocated-only scope; this page just drives the two-pane UI.
export const load = async ({ locals, params }) => {
  requireStaff(locals);
  return { courseId: params.courseId, lessonId: params.lessonId };
};
