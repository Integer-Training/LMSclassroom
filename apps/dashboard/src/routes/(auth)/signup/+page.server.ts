import { redirect } from '@sveltejs/kit';

// Closed system (PearlLMS Phase 7): there is no public self-signup — accounts are created only by staff
// provisioning (via an invite/set-password token). A tokenless visitor who lands on /signup is funnelled to
// the public registration form, the sole public entrance, which creates a pending application (never an
// account). See docs/ONBOARDING-MODEL.md §2.
export const load = async () => {
  redirect(308, '/register');
};
