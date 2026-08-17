import { requireAdmin } from '$lib/server/guards';

// PearlLMS Phase 4 — admin-only authoring sub-page. The parent course layout now admits enrolled learners
// (to reach the lesson view), so this page carries its own requireAdmin server guard.
export const load = async ({ locals }) => {
  requireAdmin(locals);
  return {};
};
