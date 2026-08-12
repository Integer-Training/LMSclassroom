import { redirect } from '@sveltejs/kit';

// Closed system: no public org self-onboarding. A provisioned user already belongs to the single
// org, so the "create your academy" flow is not reachable for them — send them to their home. Only
// a brand-new instance with zero organizations (first-run bootstrap) may reach the create-org flow;
// the API (createOrganizationWithOwner) still enforces the one-org limit server-side.
export const load = async ({ locals }) => {
  if ((locals.organizations?.length ?? 0) > 0) {
    redirect(303, '/');
  }
  return {};
};
