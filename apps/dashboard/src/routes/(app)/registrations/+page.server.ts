import { requireManagerOrAdmin } from '$lib/server/guards';

// PearlLMS Phase 7 Step 3 — the approval queue landing. MANAGER or ADMIN only (Tutor + Learner denied). The
// API re-enforces the same guard and binds every read/decision to the actor's org. Top-level route (not under
// the Admin-only org/[slug] shell) so Managers can reach it.
export const load = async ({ locals }) => {
  requireManagerOrAdmin(locals);
  return {};
};
