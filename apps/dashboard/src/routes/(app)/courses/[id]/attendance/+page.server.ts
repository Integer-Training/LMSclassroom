import { requireAdmin } from '$lib/server/guards';

// PearlLMS Phase 4 — admin-only sub-page; guards itself now that the course layout admits enrolled learners.
export const load = async ({ locals }) => {
  requireAdmin(locals);
  return {};
};
