import 'dotenv/config';
import './instrument';

import { API_PORT } from '@api/constants';
import { app } from '@api/app';
import { configureOpenAPI } from '@api/utils/openapi';
import { connectRedis } from '@cio/core/utils/redis/redis';
import { env } from '@cio/core/config/env';
import { preloadVerifiedCustomDomainOriginsRegistry } from '@api/utils/origins';
import { registerProcessErrorGuards } from '@api/process-error-guards';
import { assertSelfHostedFlag } from '@api/utils/assert-selfhosted-flag';
import { serve } from '@hono/node-server';
import { showRoutes } from 'hono/dev';

registerProcessErrorGuards();

// PearlLMS Phase-10 HP/D29 — fail fast if the self-hosted flag is not explicitly set (an unset value silently
// flips the deploy into CLOUD mode and can re-open public signup). Boots before the server binds.
assertSelfHostedFlag(process.env.PUBLIC_IS_SELFHOSTED);

// Start server
async function startServer() {
  console.log('Starting server on port:', API_PORT);

  // Connect to Redis (non-blocking: API starts even if Redis fails)
  await connectRedis();

  preloadVerifiedCustomDomainOriginsRegistry().then(() => {
    console.log('Verified custom domain origins preloaded');
  });

  serve({ fetch: app.fetch, port: API_PORT });

  if (env.NODE_ENV !== 'production') {
    showRoutes(app, { colorize: true });
  }
}

configureOpenAPI(app);

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
