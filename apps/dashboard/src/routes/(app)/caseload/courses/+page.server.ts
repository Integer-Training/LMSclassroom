import { requireStaff } from '$lib/server/guards';

// Tutor "My Courses" (PearlLMS Phase 8). ADMIN or TUTOR only. The pipeline API re-enforces the
// allocated-only scope; this page just renders the programmes the tutor is allocated to.
export const load = async ({ locals }) => {
  requireStaff(locals);
  return {};
};
