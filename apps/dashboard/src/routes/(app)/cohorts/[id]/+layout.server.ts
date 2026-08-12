import { requireAdmin } from '$lib/server/guards';

// Cohort management surface — ADMIN only in Phase 1 (tutor/team cohort features arrive later).
export const load = async ({ params, locals }) => {
  requireAdmin(locals);

  return {
    cohortId: params.id
  };
};
