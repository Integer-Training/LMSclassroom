import { requireManagerOrAdmin } from '$lib/server/guards';

// PearlLMS Phase 6 Step 5 — the staff compose + manage surface. ADMIN or MANAGER only (Tutor + Learner
// denied — D1 refined). Top-level (not under /org/[slug], which is Admin-only) so a Manager can reach it too.
export const load = async ({ locals }) => {
  requireManagerOrAdmin(locals);
  return {};
};
