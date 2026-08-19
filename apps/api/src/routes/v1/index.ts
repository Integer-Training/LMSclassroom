import { Hono } from '@api/utils/hono';
import { publicApiCors } from '@api/middlewares/cors';
import { blockWhenSelfHosted } from '@api/middlewares/self-hosted';
import { v1AudienceRouter } from './audience';
import { v1CoursesRouter } from './courses';

// PearlLMS Phase 7 Step 5 — the public API (Zapier/MCP target) is DISABLED on the self-hosted deployment
// (docs/INTEGRATIONS.md W1): the owner does not use it and it can read/write learner/audience records.
export const v1Router = new Hono()
  .use('*', blockWhenSelfHosted)
  .use('*', publicApiCors)
  .route('/audience', v1AudienceRouter)
  .route('/courses', v1CoursesRouter);
