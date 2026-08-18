import { requireManagerOrAdmin } from '$lib/server/guards';

// PearlLMS Phase 5 Step 4 — provider-wide progress report landing. MANAGER or ADMIN only (requireManagerOrAdmin
// denies Tutor and Learner). This is the Manager's landing (replacing the Phase-1 interim /welcome). The API
// re-enforces the same guard and binds every read to the actor's org.
export const load = async ({ locals }) => {
  requireManagerOrAdmin(locals);
  return {};
};
