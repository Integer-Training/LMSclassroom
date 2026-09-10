import { redirect } from '@sveltejs/kit';

// PearlLMS: learners cannot edit their profile (name/email). The former profile page at /lms/settings is
// removed — send it to the only remaining learner setting, Notifications.
export const load = () => {
  throw redirect(303, '/lms/settings/notifications');
};
