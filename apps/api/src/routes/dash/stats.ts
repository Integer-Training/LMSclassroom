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
import { getAdminOverview, getOnlineNow, type AdminOverview } from '@api/services/dash/admin-overview';
import { getCompletionsReport, getLearnersReport } from '@api/services/dash/reports';
import { getOrgComplianceOverview } from '@api/services/course/compliance';
import { handleError } from '@api/utils/errors';
import { requireManagerOrAdmin, requireSameOrg } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import {
  getCountryBreakdown,
  getCourseFunnel,
  getLandingStats,
  getPopularTypes,
  ingestEventBatch
} from '@api/services/analytics';

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

        const result = await getOrganisationAnalytics(orgId, siteName);

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
        const result = await getOrgComplianceOverview(orgId);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load compliance overview');
      }
    }
  )
  // Admin analytics command-center bundle (Manager/Admin). Cached ~60s per org (heavy aggregate).
  .get(
    '/admin-overview',
    authMiddleware,
    requireManagerOrAdmin,
    requireSameOrg(),
    zValidator('query', ZDashComplianceOverview),
    async (c) => {
      try {
        const { orgId } = c.req.valid('query');
        const cached = readOverviewCache(orgId);
        if (cached) return c.json({ success: true, data: cached }, 200);
        const result = await getAdminOverview(c.get('actor') as Actor);
        writeOverviewCache(orgId, result);
        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to load admin overview');
      }
    }
  )
  // Learner progression report (Manager/Admin) — activity mix, progress distribution, at-risk list.
  .get('/reports/learners', authMiddleware, requireManagerOrAdmin, async (c) => {
    try {
      return c.json({ success: true, data: await getLearnersReport(c.get('actor') as Actor) }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load learners report');
    }
  })
  // Completions & certificates report (Manager/Admin) — totals, trend, per-course completion + time.
  .get('/reports/completions', authMiddleware, requireManagerOrAdmin, async (c) => {
    try {
      return c.json({ success: true, data: await getCompletionsReport(c.get('actor') as Actor) }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load completions report');
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

// Tiny in-memory TTL cache for the admin-overview bundle (single-node droplet). 60s is well within the
// dashboard's usefulness window and keeps the heavy per-tutor/per-course aggregation off every refresh.
const OVERVIEW_TTL_MS = 60_000;
const overviewCache = new Map<string, { at: number; data: AdminOverview }>();
function readOverviewCache(orgId: string): AdminOverview | null {
  const hit = overviewCache.get(orgId);
  if (hit && Date.now() - hit.at < OVERVIEW_TTL_MS) return hit.data;
  return null;
}
function writeOverviewCache(orgId: string, data: AdminOverview): void {
  overviewCache.set(orgId, { at: Date.now(), data });
}
