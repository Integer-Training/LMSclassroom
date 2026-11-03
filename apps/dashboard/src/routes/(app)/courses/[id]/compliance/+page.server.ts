import { requireRole } from '$lib/server/guards';

// PearlLMS Phase 4 — admin overview + the learner's own compliance view; guards itself now that the course
// layout admits enrolled learners. The API enforces self / Admin / allocated-Tutor on the history it serves.
export const load = async ({ locals }) => {
  requireRole(locals, 'ADMIN', 'STUDENT');
  return {};
};
