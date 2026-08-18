import { Hono } from '@api/utils/hono';
import type { Actor } from '@cio/db/actor';
import { handleError } from '@api/utils/errors';
import { requireManagerOrAdmin } from '@api/middlewares/guards';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getProviderProgressReport, listOrgReportableCourses } from '@api/services/reports/progress-report';

// PearlLMS Phase 5 Step 4 — provider-wide progress + completion report. Manager OR Admin only across the
// board (requireManagerOrAdmin — Tutor and Learner are denied, actor-based, fresh per request). The actor's
// org is taken from the resolved Actor; the report carries no profile PII. Mounted at /reports.
const ZProgressReportQuery = z.object({ courseId: z.string().uuid() });

export const reportsRouter = new Hono()
  // Courses in the actor's org, for the report's course filter.
  .get('/progress/courses', requireManagerOrAdmin, async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const data = await listOrgReportableCourses(actor);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list reportable courses');
    }
  })
  // The per-course report: every enrolled learner's name + passed/total + current position + completion.
  .get('/progress', requireManagerOrAdmin, zValidator('query', ZProgressReportQuery), async (c) => {
    try {
      const actor = c.get('actor') as Actor;
      const { courseId } = c.req.valid('query');
      const data = await getProviderProgressReport(actor, courseId);
      return c.json({ success: true, data }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load progress report');
    }
  });
