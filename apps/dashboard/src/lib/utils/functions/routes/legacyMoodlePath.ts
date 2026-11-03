/**
 * Old Moodle addresses learners still have in bookmarks, emails and browser history: every Moodle page ends in
 * `.php` (/login/index.php, /course/view.php?id=…, /mod/assign/view.php) and the Moodle dashboard is /my/. None of
 * these exist in this app, so hooks.server.ts sends them to `/` instead of a "Page not found".
 */
export function isLegacyMoodlePath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path.endsWith('.php') || path === '/my' || path.startsWith('/my/');
}
