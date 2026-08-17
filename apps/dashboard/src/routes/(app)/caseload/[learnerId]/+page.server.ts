import { requireStaff } from '$lib/server/guards';

// Caseload learner detail. ADMIN or TUTOR only; the API additionally re-checks that a TUTOR is
// allocated to this learnerId (URL-tamper defence), so pasting another tutor's learner id is denied
// server-side regardless of this page rendering.
export const load = async ({ locals, params }) => {
  requireStaff(locals);
  return { learnerId: params.learnerId };
};
