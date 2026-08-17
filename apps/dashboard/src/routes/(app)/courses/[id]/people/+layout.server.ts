import { requireAdmin } from '$lib/server/guards';

// PearlLMS Phase 4 — admin-only people/roster surface. One chokepoint guards `people/` and
// `people/[personId]/` now that the course layout admits enrolled learners.
export const load = async ({ locals }) => {
  requireAdmin(locals);
  return {};
};
