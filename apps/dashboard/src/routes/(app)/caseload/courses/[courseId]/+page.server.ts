import { requireStaff } from '$lib/server/guards';

// Tutor read-only course view (units + materials + per-assessment stats). ADMIN or TUTOR only. The
// caseload content API re-enforces the allocated-only scope; this page just drives the UI.
export const load = async ({ locals, params }) => {
  requireStaff(locals);
  return { courseId: params.courseId };
};
