import { ROLE } from '@cio/utils/constants';

/**
 * PearlLMS (closed system) — the post-login HOME for a role. Single source of truth used by the root
 * redirect (routes/+page.server.ts), the client post-auth routing (init.svelte.ts), and the logo/home
 * links, so the landing logic can never drift between them. There is no public marketing landing.
 *
 *   Admin   → /org/{siteName}/dash  (the analytics/overview dashboard)
 *   Tutor   → /caseload             (grading pipeline)
 *   Manager → /reports              (progress reports)
 *   Student → /lms                  (my learning) — also the safe fallback for any unknown role
 */
export function homeForRole(roleId: number | null | undefined, siteName: string): string {
  switch (roleId) {
    case ROLE.ADMIN:
      return siteName ? `/org/${siteName}/dash` : '/lms';
    case ROLE.TUTOR:
      return '/caseload';
    case ROLE.MANAGER:
      return '/reports';
    default:
      return '/lms';
  }
}
