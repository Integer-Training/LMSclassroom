import { redirect } from '@sveltejs/kit';

// Closed system: there is no public self-registration. The sign-up form is retired — any hit on
// /signup is redirected to the login page. Accounts are created only by staff provisioning.
export const load = async () => {
  redirect(308, '/login');
};
