import { describe, expect, it } from 'vitest';

import { isLegacyMoodlePath } from '../../../../dashboard/src/lib/utils/functions/routes/legacyMoodlePath';

// Old Moodle bookmarks and email links are sent to / (then login or the learner's home) instead of "Page not found".
describe('old Moodle addresses', () => {
  it.each([
    '/login/index.php',
    '/course/view.php',
    '/mod/assign/view.php',
    '/INDEX.PHP',
    '/my',
    '/my/',
    '/my/courses.php'
  ])('redirects %s', (path) => {
    expect(isLegacyMoodlePath(path)).toBe(true);
  });

  it.each(['/', '/login', '/lms', '/lms/mylearning', '/myaccount', '/courses/c1/lessons', '/api/auth/login-link'])(
    'leaves %s alone',
    (path) => {
      expect(isLegacyMoodlePath(path)).toBe(false);
    }
  );
});
