import { requireStaff } from '$lib/server/guards';

// Tutor Learner-Progression (PearlLMS Phase 9). ADMIN or TUTOR only — requireStaff denies Learner and
// Manager. The API re-enforces this plus the allocation-scoped rule on every /caseload/progression request.
export const load = async ({ locals }) => {
  requireStaff(locals);
  return {};
};
