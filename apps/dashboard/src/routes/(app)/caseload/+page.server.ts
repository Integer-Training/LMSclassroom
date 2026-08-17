import { requireStaff } from '$lib/server/guards';

// Tutor caseload landing (PearlLMS Phase 3 Step 4). ADMIN or TUTOR only — requireStaff denies Learner
// and Manager (Manager reports arrive Phase 5). The API re-enforces this and the allocated-only rule.
export const load = async ({ locals }) => {
  requireStaff(locals);
  return {};
};
