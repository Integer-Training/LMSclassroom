import { redirect } from '@sveltejs/kit';

// PearlLMS: learner Integrations are removed entirely — bounce any direct hit to Notifications.
export const load = () => {
  throw redirect(303, '/lms/settings/notifications');
};
