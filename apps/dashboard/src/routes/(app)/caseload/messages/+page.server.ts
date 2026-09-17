import { requireStaff } from '$lib/server/guards';

// Tutor Messages inbox (PearlLMS). ADMIN or TUTOR only. The API re-enforces participant-only access per
// thread; this page lists the conversations the tutor is a participant in.
export const load = async ({ locals }) => {
  requireStaff(locals);
  return {};
};
