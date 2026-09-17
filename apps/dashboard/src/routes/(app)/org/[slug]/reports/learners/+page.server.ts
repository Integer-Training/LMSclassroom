import { requireManagerOrAdmin } from '$lib/server/guards';

// Admin/Manager reports. The API re-enforces the role on every read.
export const load = async ({ locals }) => {
  requireManagerOrAdmin(locals);
  return {};
};
