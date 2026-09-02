import { requireStaff } from '$lib/server/guards';

// Tutor caseload shell (PearlLMS Phase 8). ADMIN or TUTOR only — requireStaff denies Learner and
// Manager. The API re-enforces this plus the allocated-only rule on every /caseload request.
export const load = async ({ locals }) => {
  requireStaff(locals);
  return {};
};
