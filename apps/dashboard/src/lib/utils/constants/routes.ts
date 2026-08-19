export const ROUTE = {
  HOME: '/',
  DASHBOARD: '/dashboard',
  LMS_HOME: '/home',
  ONBOARDING: '/onboarding',
  COURSES: '/courses',
  PAGES: '/pages',
  COURSE: '/course',
  LOGIN: '/login',
  SIGN_UP: '/signup',
  INVITE: '/invite',
  PROFILE: '/profile',
  PEOPLE: '/people',
  DISCUSSIONS: '/discussions',
  ASK: '/ask',
  FORGOT: '/forgot',
  RESET: '/reset',
  LOGOUT: '/logout',
  AUTH_FAILED: '/auth-failed',
  VERIFY_EMAIL_ERROR: '/verify-email-error'
};

// Entries are matched as regexes against the request PATHNAME. They are anchored (^…$ or ^…/.*) so
// a path merely *containing* a public segment (e.g. `/org/x/reset-progress`) is NOT treated as
// public — an unanchored bare string like `/reset` used to match anywhere and silently skip the
// auth gate. Server-side layout guards (Step 5) are the real authority; anchoring removes the footgun.
export const PUBLIC_ROUTES = [
  `^${ROUTE.HOME}$`,
  `^${ROUTE.LOGIN}$`,
  `^${ROUTE.LOGOUT}$`,
  `^${ROUTE.SIGN_UP}$`,
  `^${ROUTE.INVITE}/.*`,
  `^${ROUTE.FORGOT}$`,
  `^${ROUTE.RESET}$`,
  `^${ROUTE.PAGES}/.*`,
  `^${ROUTE.COURSE}/[^/]+(/enroll)?/?$`,
  `^${ROUTE.COURSE}/[^/]+/lesson/.*`,
  `^${ROUTE.COURSES}/?$`,
  '^/404$',
  `^${ROUTE.VERIFY_EMAIL_ERROR}$`,
  `^${ROUTE.AUTH_FAILED}$`,
  '^/csp-report$'
];

// PearlLMS Phase 7 Step 5 — the Polar commerce routes (incl. /api/polar/webhook) were removed
// (docs/INTEGRATIONS.md C1); a closed provisioned LMS has no commerce.
export const PUBLIC_API_ROUTES = ['/api/lmz', '/api/verify'];

export const ROUTES_TO_HIDE_NAV = [
  `^${ROUTE.LOGIN}$`,
  `^${ROUTE.SIGN_UP}$`,
  ROUTE.LMS_HOME,
  `^${ROUTE.INVITE}/.*`,
  `^/course/.*/enroll$`,
  `^${ROUTE.FORGOT}$`,
  `^${ROUTE.RESET}$`,
  `^${ROUTE.ONBOARDING}$`,
  `^${ROUTE.VERIFY_EMAIL_ERROR}$`
];
