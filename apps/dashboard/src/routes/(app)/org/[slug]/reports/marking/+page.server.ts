import { requireManagerOrAdmin } from '$lib/server/guards';

export const load = async ({ locals }) => {
  requireManagerOrAdmin(locals);
  return {};
};
