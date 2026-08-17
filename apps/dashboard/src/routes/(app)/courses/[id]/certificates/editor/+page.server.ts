import { requireAdmin } from '$lib/server/guards';

// PearlLMS Phase 4 — admin-only certificate editor (no server load existed before). Guards itself now that
// the course layout admits enrolled learners.
export const load = async ({ locals }) => {
  requireAdmin(locals);
  return {};
};
