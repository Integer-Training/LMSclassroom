import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import {
  ZDashAnalyticsRange,
  ZDashComplianceOverview,
  ZDashCourseFunnel,
  ZDashStats,
  ZIngestBatch,
  ZLoginActivity
} from '@cio/utils/validation/dash';
import { authMiddleware } from '@api/middlewares/auth';
import { getCurrentUserLoginStreak, getOrganisationAnalytics, getStudentLoginActivity } from '@api/services/dash';
import { getAdminOverview, getOnlineNow } from '@api/services/dash/admin-overview';
import {
  getCompletionsReport,
  getLearnersReport,
  getReferralsReport,
  getTutorFeedbackReport
} from '@api/services/dash/reports';
import { getSystemEventsReport } from '@api/services/dash/system-events';
import { getOrgComplianceOverview } from '@api/services/course/compliance';
import { handleError } from '@api/utils/errors';
import { cachedOrgReport } from '@api/utils/swr-cache';
import { requireAdmin, requireManagerOrAdmin, requireSameOrg } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import {
  getCountryBreakdown,
  getCourseFunnel,
  getLandingStats,
  getPopularTypes,
  ingestEventBatch
} from '@api/services/analytics';

// The role guards on every cached route already refuse unauthenticated callers; this narrows the type for orgId.
type AuthedActor = Extract<Actor, { authenticated: true }>;

export const dashAnalyticsRouter = new Hono()
  .post('/track', zValidator('json', ZIngestBatch), async (c) => {
    try {
      const batch = c.req.valid('json');
      const user = c.get('user');

      const result = await ingestEventBatch(batch, {
        country: c.req.header('cf-ipcountry') ?? c.req.header('CF-IPCountry') ?? null,
        userAgent: c.req.header('user-agent') ?? null,
        userId: user?.id ?? null
      });

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to ingest analytics events');
    }
  })
  .get(
    '/stats',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashStats),
    async (c) => {
      try {
        const { orgId, siteName } = c.req.valid('query');
        const actor = c.get('actor') as AuthedActor;

        // Role + same-org guards above already ran. Single-flight + SWR, keyed by the actor's org and the exact query.
        const result = await cachedOrgReport(`stats:${orgId ?? ''}|${siteName ?? ''}`, actor.orgId, () =>
          getOrganisationAnalytics(orgId, siteName)
        );

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load organisation analytics');
      }
    }
  )
  .get(
    '/login-activity',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZLoginActivity),
    async (c) => {
      try {
        const { orgId, days } = c.req.valid('query');

        const result = await getStudentLoginActivity(orgId!, days);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load login activity');
      }
    }
  )
  .get('/login-streak', authMiddleware, async (c) => {
    try {
      const user = c.get('user')!;
      const result = await getCurrentUserLoginStreak(user.id);

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load login streak');
    }
  })
  .get(
    '/landing-stats',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashAnalyticsRange),
    async (c) => {
      try {
        const { orgId, days } = c.req.valid('query');
        const bust = c.req.query('bust') === '1';
        const result = await getLandingStats(orgId, days, bust);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load landing stats');
      }
    }
  )
  .get(
    '/country-breakdown',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashAnalyticsRange),
    async (c) => {
      try {
        const { orgId, days } = c.req.valid('query');
        const bust = c.req.query('bust') === '1';
        const result = await getCountryBreakdown(orgId, days, bust);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load country breakdown');
      }
    }
  )
  .get(
    '/course-funnel',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashCourseFunnel),
    async (c) => {
      try {
        const { orgId, days, courseId } = c.req.valid('query');
        const bust = c.req.query('bust') === '1';
        const result = await getCourseFunnel(orgId, days, courseId, bust);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load course funnel');
      }
    }
  )
  .get(
    '/popular-types',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashAnalyticsRange),
    async (c) => {
      try {
        const { orgId, days } = c.req.valid('query');
        const bust = c.req.query('bust') === '1';
        const result = await getPopularTypes(orgId, days, bust);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load popular course types');
      }
    }
  )
  .get(
    '/compliance-overview',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashComplianceOverview),
    async (c) => {
      try {
        const { orgId } = c.req.valid('query');
        const actor = c.get('actor') as AuthedActor;
        const result = await cachedOrgReport(`compliance-overview:${orgId}`, actor.orgId, () =>
          getOrgComplianceOverview(orgId)
        );

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load compliance overview');
      }
    }
  )
  // Admin analytics command-center bundle (Manager/Admin). Single-flight + stale-while-revalidate per org (heavy aggregate).
  .get(
    '/admin-overview',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashComplianceOverview),
    async (c) => {
      try {
        const actor = c.get('actor') as AuthedActor;
        const result = await cachedOrgReport('admin-overview', actor.orgId, () => getAdminOverview(actor));
        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load admin overview');
      }
    }
  )
  // Learner progression report (Manager/Admin) — activity mix, progress distribution, at-risk list.
  .get('/reports/learners', authMiddleware, requireManagerOrAdmin, async (c) => {
    try {
      const actor = c.get('actor') as AuthedActor;
      return c.json(
        { success: true, data: await cachedOrgReport('reports-learners', actor.orgId, () => getLearnersReport(actor)) },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to load learners report');
    }
  })
  // Completions & certificates report (Manager/Admin) — totals, trend, per-course completion + time.
  .get('/reports/completions', authMiddleware, requireManagerOrAdmin, async (c) => {
    try {
      const actor = c.get('actor') as AuthedActor;
      return c.json(
        {
          success: true,
          data: await cachedOrgReport('reports-completions', actor.orgId, () => getCompletionsReport(actor))
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to load completions report');
    }
  })
  // Referrals / failing report (ADMIN ONLY) — per-tutor strictness + per-learner seriousness.
  .get('/reports/referrals', authMiddleware, requireAdmin, async (c) => {
    try {
      const actor = c.get('actor') as AuthedActor;
      return c.json(
        {
          success: true,
          data: await cachedOrgReport('reports-referrals', actor.orgId, () => getReferralsReport(actor))
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to load referrals report');
    }
  })
  // Tutor feedback report (ADMIN ONLY) — per-tutor average ratings + the individual learner entries.
  .get('/reports/tutor-feedback', authMiddleware, requireAdmin, async (c) => {
    try {
      const actor = c.get('actor') as AuthedActor;
      return c.json(
        {
          success: true,
          data: await cachedOrgReport('reports-tutor-feedback', actor.orgId, () => getTutorFeedbackReport(actor))
        },
        200
      );
    } catch (error) {
      return handleError(c, error, 'Failed to load tutor feedback report');
    }
  })
  // Activity log (ADMIN ONLY) — system_event_log viewer; filters: from,to,eventType,severity,status,email,limit.
  .get('/reports/activity-log', authMiddleware, requireAdmin, async (c) => {
    try {
      const q = c.req.query();
      const isoDate = (v?: string) =>
        v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : undefined;
      const num = (v?: string) => (v && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
      const filters = {
        from: isoDate(q.from),
        to: isoDate(q.to),
        eventType: q.eventType || undefined,
        severity: q.severity || undefined,
        status: num(q.status),
        email: q.email?.trim() || undefined,
        limit: num(q.limit)
      };
      return c.json({ success: true, data: await getSystemEventsReport(c.get('actor') as Actor, filters) }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load activity log');
    }
  })
  // Near-live "online now" panel (Manager/Admin). Uncached — the dashboard polls it every ~45s.
  .get(
    '/online-now',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashComplianceOverview),
    async (c) => {
      try {
        const result = await getOnlineNow(c.get('actor') as Actor);
        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load online users');
      }
    }
  );
